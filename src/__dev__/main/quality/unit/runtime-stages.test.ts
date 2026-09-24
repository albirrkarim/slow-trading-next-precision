import { beforeEach, describe, expect, it, vi } from "vitest";

const MINUTE_MS = 60_000;
const NOW = Date.UTC(2026, 8, 3, 10, 4);

const mocks = vi.hoisted(() => ({
  appendError: vi.fn(async () => undefined),
  central: vi.fn(async () => true),
  monitor: vi.fn(async () => undefined),
  monitorNotifRun: vi.fn(async () => undefined),
  readCombined: vi.fn(async () => []),
  readRange: vi.fn(async (_params?: any) => [] as any[]),
  statusByMode: {} as Record<string, any>,
  upsert: vi.fn(async () => undefined),
}));

vi.mock("@/lib/system/notification", () => ({
  monitorNotif: { run: mocks.monitorNotifRun },
  systemNotif: { central: mocks.central },
}));

vi.mock("@/lib/system/logging", () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  systemLog: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock("@/lib/precision/monitoring", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/precision/monitoring")
  >();
  return {
    ...actual,
    default: {
      ...actual.default,
      position: { monitor: mocks.monitor },
    },
  };
});

vi.mock("@/lib/system/storage", () => ({
  runtimeBalanceSnapshots: {
    readCombined: mocks.readCombined,
    upsert: mocks.upsert,
  },
  runtimeLogs: {
    appendError: mocks.appendError,
  },
  runtimeStorage: {
    catalog: { load: vi.fn(async () => null) },
    history: { readRange: mocks.readRange },
    status: {
      load: vi.fn(async (mode: string) => mocks.statusByMode[mode] ?? {}),
      update: vi.fn(async (mode: string, mutate: any) => {
        const current = { ...(mocks.statusByMode[mode] ?? {}) };
        const next = mutate(current) ?? current;
        mocks.statusByMode[mode] = next;
        return next;
      }),
    },
  },
}));

import { RuntimeEngine } from "@/lib/precision";
import schedule from "@/lib/precision/monitoring/schedule";
import type {
  RuntimeContext,
  RuntimeEngineAdapter,
  RuntimeEngineState,
} from "@/lib/precision/types";
import productionStages from "@/lib/production/stages";
import { DEFAULT_BLACK_SWAN_CONFIG } from "@/lib/system/trading/black-swan";

function candle(openTime: number, close: number) {
  return [
    openTime,
    String(close),
    String(close),
    String(close),
    String(close),
    "1",
    openTime + MINUTE_MS - 1,
  ] as never;
}

function crashCandles(latestCloseTime: number) {
  const candles: never[] = [];
  const latestOpen = latestCloseTime - MINUTE_MS + 1;
  for (let open = latestOpen - 64 * MINUTE_MS; open < latestOpen; open += MINUTE_MS) {
    candles.push(candle(open, open >= latestOpen - 2 * MINUTE_MS ? 90 : 100));
  }
  return candles;
}

function createState(
  overrides: Partial<RuntimeEngineState> = {},
): RuntimeEngineState {
  return {
    balance: {},
    config: {
      accounts: [],
      management: {
        exchangeType: "binance",
        symbols: [],
        tradingMode: "spot",
      },
      runtime: {
        autoEntryDailyPnlLimitUSDT: -50,
        autoEntryEnabled: true,
        autoExitEnabled: true,
        blackSwanStageIntervalMinutes: 1,
        captureEntryStageIntervalMinutes: 1,
        entrySignalBypass: false,
        managementStageIntervalMinutes: 1,
        pnlHistoryBucketMinutes: 5,
        runnerEnabled: true,
        speedupStageIntervalMinutes: 1,
        standardMonitoringStageIntervalMinutes: 1,
      },
    },
    currentTime: 2 * MINUTE_MS,
    markPriceMap: {},
    mode: "sandbox",
    openPositions: [],
    vPointsMap: {},
    ...overrides,
  } as unknown as RuntimeEngineState;
}

function createAdapter(
  state: RuntimeEngineState,
  overrides: Partial<RuntimeEngineAdapter> = {},
): RuntimeEngineAdapter {
  let clockTime = state.currentTime;
  let finishedCalls = 0;
  return {
    clock: {
      advanceTo(time) {
        clockTime = time;
      },
      finished() {
        finishedCalls += 1;
        return finishedCalls > 1;
      },
      now() {
        return clockTime;
      },
    },
    exchange: {
      getFeeRate: () => 0,
      getRoundTripFeeRate: () => 0,
    },
    market: {
      getKlines: async () => [candle(0, 1.5)],
    },
    onAction: async () => null,
    onExit: async () => undefined,
    onNotif: () => true,
    onStrategy: async () => true,
    ...overrides,
  };
}

describe("RuntimeEngine environment stages", () => {
  it("dispatches sentinel and management hooks in stage order with stats", async () => {
    const state = createState();
    const order: string[] = [];
    const stageStats: Array<{ stage: string; stats: any }> = [];
    const cycles: any[] = [];

    const adapter = createAdapter(state, {
      onCycleComplete: async (stats) => {
        cycles.push(stats);
      },
      onManagement: async () => {
        order.push("management");
        return { summary: "management done" };
      },
      onRiskSentinel: async () => {
        order.push("risk-sentinel");
        return { summary: "sentinel done", symbols: 7 };
      },
      onStageStats: async (stage, stats) => {
        stageStats.push({ stage, stats });
      },
    });

    const engine = new RuntimeEngine(state, adapter);
    await engine.start();

    // speedup is skipped without speedup positions; the rest run in
    // RUNTIME_STAGE_ORDER.
    expect(order).toEqual(["risk-sentinel", "management"]);
    expect(stageStats.map((item) => item.stage)).toEqual([
      "risk-sentinel",
      "standard-monitoring",
      "management",
      "capture-entry",
    ]);

    const sentinel = stageStats.find(
      (item) => item.stage === "risk-sentinel",
    )?.stats;
    expect(sentinel?.summary).toBe("sentinel done");
    expect(sentinel?.symbols).toBe(7);

    const management = stageStats.find(
      (item) => item.stage === "management",
    )?.stats;
    expect(management?.summary).toBe("management done");

    expect(cycles).toHaveLength(1);
    expect(cycles[0].performance.sections).toHaveLength(4);
    expect(cycles[0].summary).toMatch(/4 stage\(s\) completed/);
  });

  it("keeps the engine alive when a stage body throws", async () => {
    const state = createState();
    const stageStats: Array<{ stage: string; stats: any }> = [];
    const cycles: any[] = [];

    const adapter = createAdapter(state, {
      onCycleComplete: async (stats) => {
        cycles.push(stats);
      },
      onManagement: async () => {
        throw new Error("management exploded");
      },
      onStageStats: async (stage, stats) => {
        stageStats.push({ stage, stats });
      },
    });

    const engine = new RuntimeEngine(state, adapter);
    await engine.start();

    // The failing stage recorded a failed pass instead of aborting the loop,
    // and the stages after it still ran.
    expect(stageStats.map((item) => item.stage)).toEqual([
      "standard-monitoring",
      "management",
      "capture-entry",
    ]);
    const management = stageStats.find(
      (item) => item.stage === "management",
    )?.stats;
    expect(management?.summary).toMatch(
      /management pass failed: management exploded/,
    );
    expect(mocks.appendError).toHaveBeenCalledWith(
      expect.objectContaining({ source: "runtime.stage.management" }),
    );
    expect(cycles).toHaveLength(1);
  });

  it("survives a cycle-level failure and keeps scheduling", async () => {
    const state = createState();
    let finishedCalls = 0;
    let advanceCalls = 0;
    const stageStats: string[] = [];
    const adapter = createAdapter(state, {
      clock: {
        advanceTo(time) {
          advanceCalls += 1;
          if (advanceCalls === 1) {
            throw new Error("advance exploded");
          }
          state.currentTime = time;
        },
        finished() {
          finishedCalls += 1;
          return finishedCalls > 2;
        },
        now() {
          return state.currentTime;
        },
      },
      onStageStats: async (stage) => {
        stageStats.push(stage);
      },
    });

    const engine = new RuntimeEngine(state, adapter);
    await engine.start();

    expect(advanceCalls).toBe(2);
    expect(mocks.appendError).toHaveBeenCalledWith(
      expect.objectContaining({ source: "runtime.cycle" }),
    );
    // The second iteration ran normally after the failed first one.
    expect(stageStats).toContain("standard-monitoring");
  });

  it("includes environment-stage boundaries in getNextTime only when the hooks exist", () => {
    const state = createState({
      currentTime: 10 * MINUTE_MS,
    });
    // Intervals: sentinel 1m, management 2m, monitoring/capture 5m.
    state.config.runtime.managementStageIntervalMinutes = 2;
    state.config.runtime.standardMonitoringStageIntervalMinutes = 5;
    state.config.runtime.captureEntryStageIntervalMinutes = 5;

    expect(schedule.getNextTime(state)).toBe(15 * MINUTE_MS);
    expect(
      schedule.getNextTime(state, {
        onManagement: async () => undefined,
      }),
    ).toBe(12 * MINUTE_MS);
    expect(
      schedule.getNextTime(state, {
        onRiskSentinel: async () => undefined,
      }),
    ).toBe(11 * MINUTE_MS);
  });
});

describe("productionStages.riskSentinel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.statusByMode = {};
    mocks.readRange.mockResolvedValue([]);
    mocks.readCombined.mockResolvedValue([]);
  });

  function contextWith(position?: any): RuntimeContext {
    return {
      adapter: {
        market: {
          getKlines: vi.fn(async ({ symbol }: any) =>
            symbol === "BTC_USDT" || symbol === "SUI_USDT"
              ? crashCandles(NOW)
              : [],
          ),
        },
      },
      helper: {} as RuntimeContext["helper"],
      state: {
        config: {
          accounts: [{ enabled: true, slug: "acc-1" }],
          management: {
            blackSwan: { ...DEFAULT_BLACK_SWAN_CONFIG, enabled: true },
            exchangeType: "binance",
            symbols: ["SUI"],
            tradingMode: "futures",
          },
          runtime: {
            notification: {
              email: { enabled: false, types: [] },
              telegram: {
                enabled: true,
                types: [{ id: "NOTIF_BLACK_SWAN_ACTION" }],
              },
            },
          },
        },
        currentTime: NOW,
        mode: "live",
        openPositions: position ? [position] : [],
      },
    } as unknown as RuntimeContext;
  }

  it("persists the CRISIS state, marks emergency exits, and notifies", async () => {
    const position = {
      account: "acc-1",
      control: {},
      direction: "LONG",
      symbol: "SUI_USDT",
    };
    const patch = await productionStages.riskSentinel(contextWith(position));

    const next = mocks.statusByMode.live?.blackSwan;
    expect(next?.status).toBe("CRISIS");
    expect(next?.reason).toBe("BTC_HARD_TRIGGER");

    // PROD:BLACK_SWAN_EMERGENCY_EXIT
    expect((position.control as any).forceExit?.reason).toBe(
      "BLACK_SWAN:BTC_HARD_TRIGGER",
    );
    expect(mocks.monitor).toHaveBeenCalledWith(
      expect.objectContaining({ state: expect.anything() }),
      position,
    );

    expect(mocks.central).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "telegram",
        key: "NOTIF_BLACK_SWAN_ACTION",
      }),
    );
    expect(patch?.summary).toMatch(/CRISIS/);
  });

  it("keeps positions untouched when protection is inactive", async () => {
    const context = contextWith();
    (context.adapter.market.getKlines as any).mockImplementation(
      async ({ symbol }: any) => {
        if (symbol === "BTC_USDT") {
          return crashCandles(NOW).map((kline: any) => [
            kline[0],
            kline[1],
            kline[2],
            kline[3],
            "100",
            kline[5],
            kline[6],
          ]);
        }
        return [];
      },
    );
    const patch = await productionStages.riskSentinel(context);

    expect(mocks.statusByMode.live?.blackSwan?.status).toBe("NORMAL");
    expect(mocks.monitor).not.toHaveBeenCalled();
    expect(mocks.central).not.toHaveBeenCalled();
    expect(patch?.summary).toMatch(/NORMAL/);
  });
});

describe("productionStages.management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.central.mockResolvedValue(true);
    mocks.statusByMode = {};
    mocks.readRange.mockResolvedValue([]);
    mocks.readCombined.mockResolvedValue([]);
  });

  function contextWith(): RuntimeContext {
    return {
      adapter: { market: { getKlines: vi.fn() } },
      helper: {} as RuntimeContext["helper"],
      state: {
        balance: {
          "acc-1": {
            available: 500,
            locked: 0,
            reserved: 0,
            safeHaven: 0,
            spendable: 500,
            startingBalance: 100,
            total: 500,
          },
        },
        config: {
          accounts: [
            { enabled: true, slug: "acc-1" },
            { enabled: false, slug: "acc-2" },
          ],
          management: { exchangeType: "binance", symbols: [], tradingMode: "spot" },
          runtime: {
            autoEntryDailyPnlLimitUSDT: -50,
            notification: {
              email: { enabled: false, types: [] },
              telegram: {
                enabled: true,
                types: [
                  { id: "NOTIF_DAILY_PNL_LIMIT" },
                  { id: "NOTIF_DAILY_PERFORMANCE" },
                ],
              },
            },
          },
        },
        currentTime: NOW,
        mode: "sandbox",
        openPositions: [],
      },
    } as unknown as RuntimeContext;
  }

  it("snapshots balances, persists the daily-PnL stop, and notifies once", async () => {
    // The evaluation combines live+sandbox history; rows live in live only.
    mocks.readRange.mockImplementation(async ({ mode }: any) =>
      mode === "live"
        ? ([
            {
              account: "acc-1",
              closed: { t: NOW - MINUTE_MS },
              opened: { t: NOW - 2 * MINUTE_MS },
              pnl: { netPct: -6, netUsdt: -60 },
            },
          ] as any)
        : [],
    );

    const patch = await productionStages.management(contextWith());
    const status = mocks.statusByMode.sandbox;

    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.upsert).toHaveBeenCalledWith({
      account: "acc-1",
      mode: "sandbox",
      timestamp: NOW,
      total: 500,
    });

    // PROD:DAILY_PNL_ENTRY_LIMIT
    expect(status?.dailyPnlLimitState?.usdt).toBe(-60);
    expect(mocks.central).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "telegram",
        key: "NOTIF_DAILY_PNL_LIMIT",
        // PROD:NOTIF_DAILY_PNL_LIMIT — sandbox subjects carry the prefix.
        title: expect.stringMatching(/^\[SANDBOX\] /),
      }),
    );
    expect(status?.dailyPnlLimitNotified?.telegram?.b).toBe(true);

    // Completed-day performance report marks the channel for that UTC day.
    expect(mocks.central).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "telegram",
        key: "NOTIF_DAILY_PERFORMANCE",
      }),
    );
    expect(status?.dailyPerformanceNotified?.telegram).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Post-exit notification monitors run inside the management stage.
    expect(mocks.monitorNotifRun).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "sandbox" }),
    );

    expect(patch?.summary).toMatch(/entry stop reached/);
  });

  it("does not mark the channel when delivery fails", async () => {
    mocks.readRange.mockImplementation(async ({ mode }: any) =>
      mode === "live"
        ? ([
            {
              account: "acc-1",
              closed: { t: NOW - MINUTE_MS },
              opened: { t: NOW - 2 * MINUTE_MS },
              pnl: { netPct: -6, netUsdt: -60 },
            },
          ] as any)
        : [],
    );
    mocks.central.mockResolvedValue(false);

    await productionStages.management(contextWith());
    const status = mocks.statusByMode.sandbox;

    // A failed delivery stays unmarked so the next pass retries the send.
    expect(status?.dailyPnlLimitNotified?.telegram).toBeUndefined();
    expect(status?.dailyPerformanceNotified?.telegram).toBeUndefined();
  });

  it("does not notify when the daily-PnL stop is not reached", async () => {
    mocks.readRange.mockImplementation(async ({ mode }: any) =>
      mode === "live"
        ? ([
            {
              account: "acc-1",
              closed: { t: NOW - MINUTE_MS },
              opened: { t: NOW - 2 * MINUTE_MS },
              pnl: { netPct: 1, netUsdt: 10 },
            },
          ] as any)
        : [],
    );

    await productionStages.management(contextWith());
    const status = mocks.statusByMode.sandbox;

    expect(status?.dailyPnlLimitState?.usdt).toBe(10);
    expect(
      mocks.central.mock.calls.filter(
        (call: any[]) => call[0]?.key === "NOTIF_DAILY_PNL_LIMIT",
      ),
    ).toHaveLength(0);
  });
});
