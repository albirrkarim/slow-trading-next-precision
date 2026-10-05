import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  central: vi.fn(async () => true),
  error: vi.fn(),
}));

vi.mock("@/lib/system/logging", () => ({
  systemLog: {
    error: mocks.error,
  },
}));

vi.mock("@/lib/system/notification", () => ({
  systemNotif: { central: mocks.central },
}));

import binanceRequestCoordinator, {
  BinanceCooldownError,
  type BinanceCooldownState,
} from "@/lib/exchange/platform/binance/request-coordinator";

function response<T>(data: T, headers: Record<string, string> = {}) {
  return {
    data,
    headers,
  } as any;
}

describe("Binance request coordinator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 8, 2, 12));
    binanceRequestCoordinator.state.reset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    binanceRequestCoordinator.state.reset();
    vi.useRealTimers();
  });

  it("uses endpoint-aware Binance request weights", () => {
    // PROD:BINANCE_REQUEST_COORDINATOR
    expect(
      binanceRequestCoordinator.request.weight({
        domain: "https://fapi.binance.com",
        endpoint: "/fapi/v1/klines",
        kind: "public",
        params: { limit: 500 },
      }),
    ).toBe(5);
    expect(
      binanceRequestCoordinator.request.weight({
        domain: "https://fapi.binance.com",
        endpoint: "/fapi/v1/ticker/24hr",
        kind: "public",
        params: {},
      }),
    ).toBe(40);
    expect(
      binanceRequestCoordinator.request.weight({
        domain: "https://fapi.binance.com",
        endpoint: "/fapi/v1/ticker/24hr",
        kind: "public",
        params: { symbol: "BTCUSDT" },
      }),
    ).toBe(1);
  });

  it("activates one cooldown and blocks later REST callbacks", async () => {
    const bannedUntil = Date.now() + 20 * 60_000;
    const firstRequest = vi.fn().mockRejectedValue({
      response: {
        data: {
          code: -1003,
          msg: `Way too many requests; IP banned until ${bannedUntil}`,
        },
        status: 418,
      },
    });

    await expect(
      binanceRequestCoordinator.request.run(
        {
          domain: "https://fapi.binance.com",
          endpoint: "/fapi/v1/klines",
          kind: "public",
          params: { limit: 500 },
        },
        firstRequest,
      ),
    ).rejects.toMatchObject({
      code: -1003,
      retryAt: bannedUntil + 10 * 60_000,
    });

    const blockedRequest = vi.fn().mockResolvedValue(response({ ok: true }));
    await expect(
      binanceRequestCoordinator.request.run(
        {
          domain: "https://fapi.binance.com",
          endpoint: "/fapi/v2/balance",
          kind: "private",
          params: {},
        },
        blockedRequest,
      ),
    ).rejects.toBeInstanceOf(BinanceCooldownError);

    // PROD:BINANCE_GLOBAL_COOLDOWN
    expect(firstRequest).toHaveBeenCalledTimes(1);
    expect(blockedRequest).not.toHaveBeenCalled();
    expect(binanceRequestCoordinator.cooldown.get()).toMatchObject({
      endpoint: "/fapi/v1/klines",
      exchangeRetryAt: bannedUntil,
      kind: "public",
      reason: `Way too many requests; IP banned until ${bannedUntil}`,
      retryAt: bannedUntil + 10 * 60_000,
      settleMs: 10 * 60_000,
      startedAt: Date.now(),
    });
    expect(mocks.error).toHaveBeenCalledTimes(1);

    // PROD:NOTIF_BINANCE_COOLDOWN — one send per activated cooldown; the
    // blocked second request observed the same cooldown and did not resend.
    expect(mocks.central).toHaveBeenCalledTimes(1);
    expect(mocks.central).toHaveBeenCalledWith(
      expect.objectContaining({
        dedupeKey: `binance-cooldown:${bannedUntil + 10 * 60_000}`,
        key: "NOTIF_BINANCE_COOLDOWN",
        title: expect.stringContaining("[BINANCE COOLDOWN]"),
      }),
    );
  });

  it("keeps the gate closed for a spare settle window after the ban ends", async () => {
    const bannedUntil = Date.now() + 20 * 60_000;
    await expect(
      binanceRequestCoordinator.request.run(
        {
          domain: "https://fapi.binance.com",
          endpoint: "/fapi/v1/klines",
          kind: "public",
        },
        vi.fn().mockRejectedValue({
          response: {
            data: {
              code: -1003,
              msg: `Way too many requests; IP banned until ${bannedUntil}`,
            },
            status: 418,
          },
        }),
      ),
    ).rejects.toBeInstanceOf(BinanceCooldownError);

    // PROD:BINANCE_BAN_SETTLE — the ban just ended but the spare settle
    // window still blocks new requests locally.
    vi.setSystemTime(bannedUntil + 1_000);
    const duringSettle = vi.fn().mockResolvedValue(response({ ok: true }));
    await expect(
      binanceRequestCoordinator.request.run(
        {
          domain: "https://fapi.binance.com",
          endpoint: "/fapi/v1/time",
          kind: "public",
        },
        duringSettle,
      ),
    ).rejects.toBeInstanceOf(BinanceCooldownError);
    expect(duringSettle).not.toHaveBeenCalled();

    vi.setSystemTime(bannedUntil + 10 * 60_000);
    const afterSettle = vi.fn().mockResolvedValue(response({ ok: true }));
    await binanceRequestCoordinator.request.run(
      {
        domain: "https://fapi.binance.com",
        endpoint: "/fapi/v1/time",
        kind: "public",
      },
      afterSettle,
    );
    expect(afterSettle).toHaveBeenCalledTimes(1);
  });

  it("does not add spare settle time to plain 429 rate limits", async () => {
    await expect(
      binanceRequestCoordinator.request.run(
        {
          domain: "https://fapi.binance.com",
          endpoint: "/fapi/v1/klines",
          kind: "public",
        },
        vi.fn().mockRejectedValue({
          response: {
            data: { code: -1003, msg: "Too many requests" },
            status: 429,
          },
        }),
      ),
    ).rejects.toMatchObject({ retryAt: Date.now() + 2 * 60_000 });

    // PROD:BINANCE_BAN_SETTLE — settle applies to real IP bans only.
    const cooldown = binanceRequestCoordinator.cooldown.get();
    expect(cooldown).toMatchObject({ retryAt: Date.now() + 2 * 60_000 });
    expect(cooldown?.exchangeRetryAt).toBeUndefined();
    expect(cooldown?.settleMs).toBeUndefined();
  });

  it("hydrates a persisted cooldown before invoking a REST callback", async () => {
    let persisted: ReturnType<
      typeof binanceRequestCoordinator.cooldown.get
    > = null;
    const persistence = {
      readLatest: vi.fn(async () => persisted),
      record: vi.fn(async ({ state }: { state: NonNullable<typeof persisted> }) => {
        persisted = state;
        return state;
      }),
      reset: vi.fn(async (now: number) => {
        if (persisted) persisted = { ...persisted, retryAt: now };
      }),
    };
    binanceRequestCoordinator.persistence.use(persistence);
    const bannedUntil = Date.now() + 30 * 60_000;

    await expect(
      binanceRequestCoordinator.request.run(
        {
          domain: "https://fapi.binance.com",
          endpoint: "/fapi/v2/balance",
          kind: "private",
        },
        vi.fn().mockRejectedValue({
          response: {
            data: {
              code: -1003,
              msg: `Way too many requests; IP banned until ${bannedUntil}`,
            },
            status: 418,
          },
        }),
      ),
    ).rejects.toBeInstanceOf(BinanceCooldownError);

    binanceRequestCoordinator.state.reset();
    binanceRequestCoordinator.persistence.use(persistence);
    const blockedRequest = vi.fn().mockResolvedValue(response({ ok: true }));
    await expect(
      binanceRequestCoordinator.request.run(
        {
          domain: "https://fapi.binance.com",
          endpoint: "/fapi/v1/klines",
          kind: "public",
        },
        blockedRequest,
      ),
    ).rejects.toBeInstanceOf(BinanceCooldownError);

    // PROD:BINANCE_PERSISTENT_COOLDOWN
    expect(persistence.readLatest).toHaveBeenCalled();
    expect(blockedRequest).not.toHaveBeenCalled();
  });

  it("manually resets the persistent and in-memory cooldown gate", async () => {
    const bannedUntil = Date.now() + 30 * 60_000;
    let persisted = {
      endpoint: "/fapi/v1/klines",
      kind: "public" as const,
      reason: "IP banned",
      retryAt: bannedUntil,
      startedAt: Date.now(),
    };
    const persistence = {
      readLatest: vi.fn(async () => persisted),
      record: vi.fn(async ({ state }: { state: BinanceCooldownState }) => state),
      reset: vi.fn(async (now: number) => {
        persisted = { ...persisted, retryAt: now };
      }),
    };
    binanceRequestCoordinator.persistence.use(persistence);
    await binanceRequestCoordinator.cooldown.refresh();

    await binanceRequestCoordinator.cooldown.reset();

    // PROD:BINANCE_MANUAL_COOLDOWN_RESET
    expect(persistence.reset).toHaveBeenCalledWith(Date.now());
    expect(binanceRequestCoordinator.cooldown.get()).toBeNull();
    const request = vi.fn().mockResolvedValue(response({ ok: true }));
    await binanceRequestCoordinator.request.run(
      {
        domain: "https://fapi.binance.com",
        endpoint: "/fapi/v1/klines",
        kind: "public",
      },
      request,
    );
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("does not classify rate limits as retryable failures", () => {
    // PROD:BINANCE_RATE_LIMIT_NO_RETRY
    expect(
      binanceRequestCoordinator.error.isRetryable({
        response: { status: 429 },
      }),
    ).toBe(false);
    expect(
      binanceRequestCoordinator.error.isRetryable({ code: "ECONNRESET" }),
    ).toBe(true);
    expect(
      binanceRequestCoordinator.error.isRetryable({
        response: { status: 503 },
      }),
    ).toBe(true);
    expect(
      binanceRequestCoordinator.error.isRetryable(new Error("bad request")),
    ).toBe(false);
  });

  it("defers requests after response headers report critical weight usage", async () => {
    await binanceRequestCoordinator.request.run(
      {
        domain: "https://fapi.binance.com",
        endpoint: "/fapi/v1/time",
        kind: "public",
      },
      async () => response({}, { "x-mbx-used-weight-1m": "2159" }),
    );

    const nextRequest = vi.fn().mockResolvedValue(response({ ok: true }));
    const pending = binanceRequestCoordinator.request.run(
      {
        domain: "https://fapi.binance.com",
        endpoint: "/fapi/v1/time",
        kind: "public",
      },
      nextRequest,
    );
    await Promise.resolve();
    expect(nextRequest).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_049);
    expect(nextRequest).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(nextRequest).toHaveBeenCalledTimes(1);
  });
});
