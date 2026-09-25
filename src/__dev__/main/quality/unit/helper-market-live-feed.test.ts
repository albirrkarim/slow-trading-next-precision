import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendError: vi.fn(async () => undefined),
  central: vi.fn(async () => true),
  closedKlines: vi.fn(),
  getKlines: vi.fn(),
  getSymbols: vi.fn(() => ["SUI"]),
  liveMarkPrice: vi.fn(),
  track: vi.fn(),
}));

vi.mock("@/lib/system/storage", () => ({
  runtimeLogs: { appendError: mocks.appendError },
}));

vi.mock("@/lib/system/notification", () => ({
  systemNotif: { central: mocks.central },
}));

vi.mock("@/lib/system/trading/entry", () => ({
  default: { getSymbols: mocks.getSymbols },
}));

vi.mock("@/lib/system/utils/vpoints", () => ({
  default: {
    createMemory: vi.fn((params: unknown) => params),
    processKline: vi.fn((params: { memory: unknown }) => ({
      memory: params.memory,
      point: undefined,
    })),
    retainRecent: vi.fn(
      (params: { points: unknown[] }) => params.points,
    ),
  },
}));

import market from "@/lib/precision/helper/market";
import type {
  RuntimeEngineAdapter,
  RuntimeEngineState,
} from "@/lib/precision/types";

const INTERVAL_MS = 5 * 60_000;

function closedKline(closeTime: number, price = 100) {
  return [
    closeTime - INTERVAL_MS + 1,
    String(price),
    String(price),
    String(price),
    String(price),
    "1",
    closeTime,
    "1",
    1,
    "1",
    "1",
    "0",
  ] as never;
}

function createState(now: number): RuntimeEngineState {
  return {
    balance: {},
    config: {
      accounts: [],
      management: {
        exchangeType: "binance",
        symbols: ["SUI"],
        tradingMode: "futures",
      },
      runtime: {},
    },
    currentTime: now,
    markPriceMap: {},
    openPositions: [],
    vPointsMap: {},
  } as unknown as RuntimeEngineState;
}

function createAdapter(): RuntimeEngineAdapter {
  return {
    market: {
      getKlines: mocks.getKlines,
      live: {
        closedKlines: mocks.closedKlines,
        markPrice: mocks.liveMarkPrice,
        track: mocks.track,
      },
    },
  } as unknown as RuntimeEngineAdapter;
}

describe("market helper live-feed miss logging", () => {
  let now: number;
  let state: RuntimeEngineState;
  let adapter: RuntimeEngineAdapter;
  let helper: ReturnType<typeof market.create>;

  beforeEach(() => {
    vi.useFakeTimers();
    now = Date.UTC(2026, 8, 25, 12);
    vi.setSystemTime(now);
    vi.clearAllMocks();
    state = createState(now);
    adapter = createAdapter();
    helper = market.create(state, adapter);
    mocks.getKlines.mockResolvedValue([closedKline(now - 1)]);
    mocks.liveMarkPrice.mockReturnValue(undefined);
  });

  async function pass(advanceMs = INTERVAL_MS) {
    now += advanceMs;
    vi.setSystemTime(now);
    state.currentTime = now;
    // The closed kline must trail the new currentTime to stay "closed".
    mocks.getKlines.mockResolvedValue([closedKline(now - 1)]);
    await helper.updateMarkPrice("5m");
  }

  it("serves mark prices from the feed without logging or REST", async () => {
    mocks.liveMarkPrice.mockReturnValue({ lastUpdated: now, price: 101 });
    await helper.updateMarkPrice("5m");

    expect(state.markPriceMap.SUI).toEqual({ lastUpdated: now, price: 101 });
    expect(mocks.getKlines).not.toHaveBeenCalled();
    expect(mocks.appendError).not.toHaveBeenCalled();
  });

  it("falls back to REST silently while the feed is still warming up", async () => {
    // 60s of misses stay under the 2min grace — the socket is expected to
    // need a few seconds before the first kline events arrive.
    await pass(0);
    await pass(60_000);

    expect(state.markPriceMap.SUI?.price).toBe(100);
    expect(mocks.getKlines).toHaveBeenCalled();
    expect(mocks.appendError).not.toHaveBeenCalled();
  });

  it("records an error once the feed miss outlives the grace window", async () => {
    await pass(0);
    await pass(INTERVAL_MS);
    await pass(INTERVAL_MS); // 10min of misses — past the 2min grace

    // PROD:MARKET_LIVE_FEED
    expect(mocks.appendError).toHaveBeenCalledTimes(1);
    expect(mocks.appendError).toHaveBeenCalledWith({
      error: expect.objectContaining({
        message: expect.stringContaining("SUI@5m"),
      }),
      source: "runtime.market.live-feed",
    });
  });

  it("never logs when no feed is wired (backtest)", async () => {
    // Backtest adapters carry no `live` feed at all.
    helper = market.create(state, {
      market: { getKlines: mocks.getKlines },
    } as unknown as RuntimeEngineAdapter);

    for (let i = 0; i < 30; i += 1) {
      await pass(INTERVAL_MS);
    }

    expect(mocks.appendError).not.toHaveBeenCalled();
  });

  it("resets the tracker when the feed recovers, so a new outage re-logs", async () => {
    await pass(0);
    await pass(2 * INTERVAL_MS);
    expect(mocks.appendError).toHaveBeenCalledTimes(1);

    // Feed recovers — tracker clears.
    mocks.liveMarkPrice.mockReturnValue({ lastUpdated: now, price: 101 });
    await pass(INTERVAL_MS);

    // New outage needs the full grace window again before logging.
    mocks.liveMarkPrice.mockReturnValue(undefined);
    await pass(INTERVAL_MS);
    expect(mocks.appendError).toHaveBeenCalledTimes(1);
    await pass(INTERVAL_MS);
    expect(mocks.appendError).toHaveBeenCalledTimes(2);
  });

  it("stays silent when the kline buffer cannot cover a designed backfill", async () => {
    // A window older than the buffer misses once (REST backfills), then the
    // next pass is served — the outage never outlives the grace window.
    mocks.closedKlines.mockReturnValue(undefined);
    await helper.updateVPointsMap("5m");

    now += INTERVAL_MS;
    vi.setSystemTime(now);
    state.currentTime = now;
    mocks.getKlines.mockResolvedValue([closedKline(now - 1)]);
    mocks.closedKlines.mockReturnValue([]);
    await helper.updateVPointsMap("5m");

    expect(mocks.appendError).not.toHaveBeenCalled();
  });

  it("records an error when closed klines keep missing past the grace", async () => {
    mocks.closedKlines.mockReturnValue(undefined);

    for (let i = 0; i < 3; i += 1) {
      now += INTERVAL_MS;
      vi.setSystemTime(now);
      state.currentTime = now;
      mocks.getKlines.mockResolvedValue([closedKline(now - 1)]);
      await helper.updateVPointsMap("5m");
    }

    expect(mocks.appendError).toHaveBeenCalledWith({
      error: expect.objectContaining({
        message: expect.stringContaining("SUI@5m closed klines"),
      }),
      source: "runtime.market.live-feed",
    });
  });
});
