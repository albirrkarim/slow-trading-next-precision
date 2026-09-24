import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getState: vi.fn(),
  runManual: vi.fn(),
  status: vi.fn(),
}));

vi.mock("@/lib/production", () => ({
  default: {
    runtime: {
      get: () => ({
        getState: mocks.getState,
        runManual: mocks.runManual,
        status: mocks.status,
      }),
    },
  },
}));

import runtimeMcpEngineState from "@/lib/system/mcp/engine-state";

function makeState() {
  return {
    balance: {
      main: {
        available: 100,
        locked: 20,
        reserved: 5,
        safeHaven: 0,
        spendable: 95,
        total: 120,
      },
    },
    config: {
      accounts: [
        {
          createdAt: 1,
          credentials: { apiKey: "KEY", apiSecret: "SECRET" },
          enabled: true,
          name: "Main",
          sandbox: { enabled: true },
          slug: "main",
          trading: { takeProfitPercent: 1 },
          type: "binance",
        },
      ],
      management: {
        name: "PRECISION",
        symbols: ["LINK", "ZRO"],
        tradingMode: "futures",
      },
      runtime: {
        mcp: {
          tokens: [
            {
              createdAt: 1,
              enabled: true,
              id: "tok1",
              name: "ci",
              permissions: ["engine_state.read"],
              tokenHash: "HASH",
              tokenSecretEncrypted: "ENC",
            },
          ],
        },
        runnerEnabled: true,
      },
    },
    currentTime: 1790173800000,
    markPriceMap: {
      LINK: { lastUpdated: 1790173790000, price: 12.5 },
    },
    mode: "live",
    openPositions: [
      {
        account: "main",
        direction: "LONG",
        executionMode: "live",
        exposure: {
          averageEntryPrice: 100,
          leverage: 2,
          marginUsdt: 50,
          notionalUsdt: 100,
          quantity: 1,
        },
        fees: { entryUsdt: 0.1 },
        opened: {
          message: "auto",
          price: 100,
          reason: "COMMON",
          t: 1790170000000,
          vPoint: { id: "B_open_1", lvl: -2 },
        },
        pnl: {
          history: [
            { pct: 0.1, t: 1 },
            { pct: 0.2, t: 2 },
          ],
          netPct: 1.5,
          netUsdt: 0.7,
        },
        strategy: {
          averaging: {
            entryLevel: -2,
            executions: [
              {
                allocationPct: 50,
                level: -3,
                marginUsdt: 5,
                price: 95,
                t: 1790171000000,
              },
            ],
            lastHandledLevel: -2,
            reserveBaseMarginUsdt: 10,
            reservedRemainingMarginUsdt: 5,
            steps: [],
          },
          entry: {},
        },
        symbol: "SOL_USDT",
        tradingMode: "futures",
      },
    ],
    vPointsMap: {
      LINK: [
        {
          id: "B_a",
          l: "B",
          lvl: -1,
          p: 12,
          pct: 4,
          t: 1,
          usedBy: ["Main"],
        },
        { id: "T_b", l: "T", lvl: 1, p: 13, pct: 3, t: 2 },
      ],
      ZRO: [
        { id: "B_c", l: "B", lvl: -1, p: 1.5, pct: 5, t: 3, used: true },
      ],
    },
    volume24hMap: { LINK: 12345 },
  };
}

function mockLiveRuntime() {
  const state = makeState();
  mocks.getState.mockReturnValue(state);
  mocks.status.mockReturnValue({
    processing: false,
    ready: true,
    restartPending: false,
    running: true,
  });
  mocks.runManual.mockImplementation(async (task: any) =>
    task({ state }),
  );
  return state;
}

describe("MCP engine state read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads the live engine state with lifecycle flags", async () => {
    mockLiveRuntime();
    const result = await runtimeMcpEngineState.read({});

    expect(result.schemaVersion).toBe("1.0");
    expect(result.engine).toEqual(
      expect.objectContaining({
        mode: "live",
        processing: false,
        ready: true,
        restartPending: false,
        running: true,
        stateSource: "live",
      }),
    );
    expect(result.balance.main.spendable).toBe(95);
    expect(result.markPrices.LINK).toEqual(
      expect.objectContaining({ price: 12.5 }),
    );
    expect(result.volume24h).toEqual({ LINK: 12345 });
  });

  it("reports a retained state source when the engine stopped", async () => {
    mockLiveRuntime();
    mocks.status.mockReturnValue({
      processing: false,
      ready: false,
      restartPending: false,
      running: false,
    });
    const result = await runtimeMcpEngineState.read({});
    expect(result.engine.stateSource).toBe("retained");
  });

  it("reports a hydrated state source when no engine state exists", async () => {
    mockLiveRuntime();
    mocks.getState.mockReturnValue(undefined);
    mocks.status.mockReturnValue({
      processing: false,
      ready: false,
      restartPending: false,
      running: false,
    });
    const result = await runtimeMcpEngineState.read({});
    expect(result.engine.stateSource).toBe("hydrated");
  });

  it("strips account credentials and MCP token secrets", async () => {
    mockLiveRuntime();
    const result = await runtimeMcpEngineState.read({});
    const account = result.config.accounts[0] as any;
    const token = (result.config.runtime as any).mcp.tokens[0];

    expect(account.credentials).toBeUndefined();
    expect(account.credentialStatus.configured).toBe(true);
    expect(token.tokenHash).toBeUndefined();
    expect(token.tokenSecretEncrypted).toBeUndefined();
    expect(token.secretAvailable).toBe(true);
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });

  it("derives per-account vPoint usage markers", async () => {
    mockLiveRuntime();
    const result = await runtimeMcpEngineState.read({});
    const link = result.volatilityPoints.LINK as any;
    const zro = result.volatilityPoints.ZRO as any;

    expect(link.count).toBe(2);
    expect(link.latest.id).toBe("T_b");
    expect(link.usedBy.Main).toEqual(["B_a"]);
    expect(link.used).toEqual([]);
    expect(zro.used).toEqual(["B_c"]);
    expect(link.points).toBeUndefined();
  });

  it("includes the bounded point array only for the requested symbol", async () => {
    mockLiveRuntime();
    const result = await runtimeMcpEngineState.read({
      symbol: "LINK_USDT",
    });
    const link = result.volatilityPoints.LINK as any;
    const zro = result.volatilityPoints.ZRO as any;

    expect(link.points).toHaveLength(2);
    expect(link.points[0].id).toBe("B_a");
    expect(zro.points).toBeUndefined();
  });

  it("omits pnl history by default and bounds it when requested", async () => {
    mockLiveRuntime();
    const without = await runtimeMcpEngineState.read({});
    expect((without.openPositions[0] as any).pnl.historyPoints).toBe(2);
    expect(
      (without.openPositions[0] as any).pnl.history,
    ).toBeUndefined();

    const withHistory = await runtimeMcpEngineState.read({
      includePnlHistory: true,
    });
    expect(
      (withHistory.openPositions[0] as any).pnl.history,
    ).toHaveLength(2);
  });

  it("serializes position vPoint refs and averaging executions", async () => {
    mockLiveRuntime();
    const result = await runtimeMcpEngineState.read({});
    const position = result.openPositions[0] as any;

    expect(position.opened.vPoint).toEqual({ id: "B_open_1", lvl: -2 });
    expect(position.closed).toBeUndefined();
    expect(position.averaging.executions[0]).toEqual(
      expect.objectContaining({ level: -3, marginUsdt: 5 }),
    );
  });
});
