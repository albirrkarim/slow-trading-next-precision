import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendError: vi.fn(async () => undefined),
  build: vi.fn(),
  cooldown: vi.fn(),
  loadLogs: vi.fn(),
  loadStatus: vi.fn(),
  runManual: vi.fn(),
}));

vi.mock("@/lib/production", () => ({
  default: {
    runtime: {
      get: () => ({
        runManual: mocks.runManual,
      }),
    },
  },
}));

vi.mock("@/lib/system/storage", () => ({
  runtimeLogs: {
    appendError: mocks.appendError,
    load: mocks.loadLogs,
  },
  runtimeStorage: {
    status: {
      load: mocks.loadStatus,
    },
  },
}));

vi.mock("@/lib/system/trading", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/system/trading")
  >();
  return {
    ...actual,
    entryDiagnostics: {
      ...actual.entryDiagnostics,
      build: mocks.build,
    },
  };
});

vi.mock("@/lib/exchange/platform/binance/request-coordinator", () => ({
  BinanceCooldownError: class BinanceCooldownError extends Error {
    retryAt = 0;
  },
  default: {
    cooldown: {
      get: mocks.cooldown,
    },
  },
}));

import handler from "@/pages/api/system/manual/diagnostics";

describe("entry diagnostics Binance cooldown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadLogs.mockResolvedValue({ errors: [] });
    mocks.loadStatus.mockResolvedValue({ blackSwan: undefined });
    mocks.runManual.mockImplementation(async (fn: any) =>
      fn({ state: { config: { accounts: [] }, mode: "live" } }),
    );
  });

  it("returns retryAt without starting diagnostics", async () => {
    const retryAt = Date.UTC(2026, 8, 2, 13);
    mocks.cooldown.mockReturnValue({ reason: "IP banned", retryAt });
    const json = vi.fn();
    const response = {
      json,
      setHeader: vi.fn(),
      status: vi.fn(),
    } as any;
    response.status.mockReturnValue(response);

    await handler({ method: "GET" } as any, response);

    // PROD:BINANCE_GLOBAL_COOLDOWN
    expect(response.status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith({
      error: "Binance cooldown",
      retryAt,
    });
    expect(mocks.runManual).not.toHaveBeenCalled();
    expect(mocks.build).not.toHaveBeenCalled();
  });

  it("separates shared guards and diagnostics for every enabled account", async () => {
    const accounts = [
      { enabled: true, name: "Main", slug: "1" },
      { enabled: true, name: "Second", slug: "2" },
      { enabled: false, name: "Disabled", slug: "3" },
    ];
    mocks.cooldown.mockReturnValue(null);
    mocks.loadLogs.mockResolvedValue({
      errors: [
        {
          createdAt: 123,
          id: "second-error",
          message: "Binance API Error: Invalid API-key (code: -2015)",
          source: "cycle.account.2",
          status: "new",
        },
      ],
    });
    mocks.runManual.mockImplementation(async (fn: any) =>
      fn({ state: { config: { accounts }, mode: "live" } }),
    );
    mocks.build.mockImplementation(async (_context: any, options: any) => ({
      accounts: accounts
        .filter((account) => account.enabled)
        .map((account) => ({
          account: { name: account.name, slug: account.slug },
          diagnostics: [
            { reason: `Ready for ${account.name}`, status: "ready" },
          ],
          ...(options?.latestErrors?.has(account.slug)
            ? {
                latestExecutionError:
                  options.latestErrors.get(account.slug),
              }
            : {}),
        })),
      generatedAt: 1,
      sharedGuards: [
        { code: "RUNNER_ENABLED", status: "ready" },
        { code: "AUTO_ENTRY_ENABLED", status: "ready" },
      ],
    }));
    const json = vi.fn();
    const response = {
      json,
      setHeader: vi.fn(),
      status: vi.fn(),
    } as any;
    response.status.mockReturnValue(response);

    await handler({ method: "GET" } as any, response);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(mocks.runManual).toHaveBeenCalledTimes(1);
    expect(mocks.build).toHaveBeenCalledTimes(1);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        accounts: [
          expect.objectContaining({
            account: { name: "Main", slug: "1" },
            diagnostics: [
              expect.objectContaining({ reason: "Ready for Main" }),
            ],
          }),
          expect.objectContaining({
            account: { name: "Second", slug: "2" },
            diagnostics: [
              expect.objectContaining({ reason: "Ready for Second" }),
            ],
            latestExecutionError: {
              createdAt: 123,
              id: "second-error",
              message: "Binance API Error: Invalid API-key (code: -2015)",
            },
          }),
        ],
        sharedGuards: [
          expect.objectContaining({ code: "RUNNER_ENABLED", status: "ready" }),
          expect.objectContaining({
            code: "AUTO_ENTRY_ENABLED",
            status: "ready",
          }),
        ],
      }),
    );
  });
});
