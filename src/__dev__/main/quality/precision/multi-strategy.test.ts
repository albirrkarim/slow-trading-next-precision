import { describe, expect, it } from "vitest";
import { runtimeDefaults } from "@/lib/system/runtime";
import { TradingMode } from "@/lib/exchange/types";

import type {
  RuntimeContext,
  RuntimeEngineAdapter,
  RuntimeEngineState,
  RuntimeEntryDecision,
} from "@/lib/precision/types";
import type { RuntimeHelper } from "@/lib/precision/helper/types";
import type { Kline, VolatilityPoint } from "@/lib/system/types";
import type {
  EntryRecommendation,
  Position,
} from "@/lib/system/trading";
import tradingAveraging from "@/lib/system/trading/averaging";
import tradingEntry from "@/lib/system/trading/entry";
import entryAction from "@/lib/system/trading/entry-action";
import tradingExit from "@/lib/system/trading/exit";
import systemPositions from "@/lib/precision/utils/positions";
import systemVpoints from "@/lib/system/utils/vpoints";

// The default strategy surface the shared runtime calls directly, composed
// from the system trading/utils modules and precision position bookkeeping.
const strategy = {
  market: {
    getSymbols: tradingEntry.getSymbols,
    createVPointMemory: systemVpoints.createMemory,
    detectVPoints: systemVpoints.detectVPoints,
    processVPointKline: systemVpoints.processKline,
  },
  decisions: {
    findEntries: tradingEntry.findDecisions,
    findAveraging: tradingAveraging.findDecision,
    findExit: tradingExit.findDecision,
  },
  positions: systemPositions,
  actions: {
    executeEntry: entryAction.execute,
    executeAveraging: tradingAveraging.execute,
    executeExit: tradingExit.execute,
  },
} as const;

const FIVE_MINUTES_MS = 5 * 60_000;

function makeKline(openTime: number, close: number): Kline {
  return [
    openTime,
    String(close),
    String(close),
    String(close),
    String(close),
    "10",
    openTime + FIVE_MINUTES_MS - 1,
    "1000",
    5,
    "5",
    "500",
    "",
    "",
  ];
}

describe("multi strategy vPoint stream", () => {
  it("emits the same leveled points as the legacy predictor", () => {
    const closes = [
      100, 106, 108, 106.8, 102, 100, 101.1, 106, 108, 106.8,
    ];
    const baseTime = 1_700_000_000_000;
    const klines = closes.map((close, index) =>
      makeKline(baseTime + index * FIVE_MINUTES_MS, close),
    );

    let memory = strategy.market.createVPointMemory({
      firstClose: closes[0],
      firstTime: klines[0][0],
    });
    let previousPoint: VolatilityPoint | undefined;
    const emitted: Array<Pick<VolatilityPoint, "l" | "lvl" | "p" | "t">> = [];
    const ids: string[] = [];

    for (const kline of klines.slice(1)) {
      const result = strategy.market.processVPointKline({
        kline,
        memory,
        previousPoint,
        symbol: "SUI",
      });
      memory = result.memory;
      if (!result.point) continue;
      emitted.push({
        l: result.point.l,
        lvl: result.point.lvl,
        p: result.point.p,
        t: result.point.t,
      });
      ids.push(result.point.id);
      previousPoint = result.point;
    }

    expect(
      emitted.map(({ l, p, lvl }) => ({ l, p, lvl })),
    ).toEqual([
      { l: "T", p: 108, lvl: 1 },
      { l: "B", p: 100, lvl: 0 },
      { l: "T", p: 108, lvl: 1 },
    ]);
    expect(ids.every((id) => id.length > 0)).toBe(true);
    expect(emitted.map((point) => point.t)).toEqual([
      baseTime + 2 * FIVE_MINUTES_MS,
      baseTime + 5 * FIVE_MINUTES_MS,
      baseTime + 8 * FIVE_MINUTES_MS,
    ]);

    // Batch detection over the same fixture emits the identical points.
    const detected = strategy.market.detectVPoints({
      klines,
      symbol: "SUI",
    });
    expect(
      detected.map(({ id, l, lvl, p, t }) => ({ id, l, lvl, p, t })),
    ).toEqual(
      emitted.map((point, index) => ({ ...point, id: ids[index] })),
    );
  });
});

function makeContext(
  accounts: string[],
  points: Record<string, VolatilityPoint[]>,
  options: {
    accountTrading?: Record<string, unknown>;
    currentTime?: number;
    feeRate?: number;
    markPriceMap?: RuntimeEngineState["markPriceMap"];
    roundTripFeeRate?: number;
    takeProfitPercent?: number;
    tradingMode?: "spot" | "futures";
  } = {},
): RuntimeContext {
  const state: RuntimeEngineState = {
    balance: Object.fromEntries(
      accounts.map((slug) => [
        slug,
        {
          available: 100,
          locked: 0,
          reserved: 0,
          safeHaven: 0,
          spendable: 100,
          startingBalance: 100,
          total: 100,
        },
      ]),
    ),
    config: {
      accounts: accounts.map((slug) => ({
        slug,
        name: slug,
        type: "binance" as const,
        description: "",
        credentials: { apiKey: "", apiSecret: "" },
        enabled: true,
        trading: {
          ...runtimeDefaults.trading.create(),
          maxOpenPositions: 0,
          minEntryAbsLevel: 2,
          takeProfitPercent: options.takeProfitPercent ?? 50,
          ...options.accountTrading,
        },
        sandbox: { initialBalanceUSDT: 100 },
        createdAt: 0,
        updatedAt: 0,
      })),
      management: {
        ...runtimeDefaults.management.create(),
        name: "test",
        description: "test",
        symbols: ["SUI"],
        tradingMode:
          options.tradingMode === "futures"
            ? TradingMode.FUTURES
            : TradingMode.SPOT,
        exchangeType: "binance",
        decisionEngineVersion: "decision.v20",
      },
      runtime: {
        ...runtimeDefaults.runtime.create(),
        autoEntryEnabled: true,
        autoExitEnabled: true,
        blackSwanStageIntervalMinutes: 5,
        captureEntryStageIntervalMinutes: 5,
        entrySignalBypass: false,
        managementStageIntervalMinutes: 5,
        pnlHistoryBucketMinutes: 60,
        runnerEnabled: true,
        speedupStageIntervalMinutes: 1,
        speedupStageNegativePnlThresholdPct: 1.5,
        speedupStagePositivePnlThresholdPct: 1.5,
        speedupStageTakeProfitOffsetPct: 0.5,
        standardMonitoringStageIntervalMinutes: 5,
      },
    },
    currentTime: options.currentTime ?? 0,
    markPriceMap: options.markPriceMap ?? {},
    mode: "backtest",
    openPositions: [],
    vPointsMap: points,
  };
  const helper: RuntimeHelper = {
    getAccount(slug) {
      const account = state.config.accounts.find(
        (candidate) => candidate.slug === slug,
      );
      if (!account) throw new Error(`Unknown account ${slug}.`);
      return account;
    },
    getAccountBalance(slug) {
      return state.balance[slug];
    },
    getAccountConfig(slug) {
      return helper.getAccount(slug).trading;
    },
    market: {
      updateMarkPrice: async () => undefined,
      updateVPointsMap: async () => undefined,
    },
  };
  const adapter: RuntimeEngineAdapter = {
    clock: {
      advanceTo: () => undefined,
      finished: () => true,
      now: () => state.currentTime,
    },
    exchange: {
      getFeeRate: () => options.feeRate ?? 0,
      getRoundTripFeeRate: () => options.roundTripFeeRate ?? 0,
    },
    market: { getKlines: async () => [] },
    onAction: async () => null,
    onExit: async () => undefined,
    onNotif: () => true,
    onStrategy: async () => true,
  };

  return { adapter, helper, state };
}

function makePoint(lvl: number, t: number): VolatilityPoint {
  return {
    id: `${lvl < 0 ? "B" : "T"}_id_${t}`,
    t,
    l: lvl < 0 ? "B" : "T",
    pct: 6,
    p: 100,
    vb: 1,
    vq: 1,
    lvl,
  };
}

describe("multi strategy entry decisions", () => {
  it("recommends actionable latest points per account and respects usage", async () => {
    const suiLatest = makePoint(-3, 200);
    const points = {
      BTC: [makePoint(-3, 200)],
      SUI: [makePoint(-1, 100), suiLatest],
    };
    const context = makeContext(["a1", "a2"], points);

    const first = await strategy.decisions.findEntries(context);
    expect(first).toHaveLength(2);
    for (const decision of first) {
      expect(decision.symbol).toBe("SUI");
      expect(decision.direction).toBe("LONG");
      // Legacy mapScaleValue clamps the descending B range so every B point
      // resolves to the outputMin: 0.5 regardless of level.
      expect(decision.entrySignal.amountProbab).toBeCloseTo(0.5, 6);
      expect(decision.entrySignal.maxLeverage).toBe(3);
      expect(decision.message).toBe(
        "decision.v20 LONG: absolute level 3 meets minimum 2",
      );
      expect(decision.type).toBe("entry");
    }
    expect(first.map((decision) => decision.accountSlug).sort()).toEqual([
      "a1",
      "a2",
    ]);
    expect(first.some((decision) => decision.symbol === "BTC")).toBe(false);

    // The shared point itself is not marked used by decision evaluation.
    expect(suiLatest.used).toBeUndefined();
    expect(suiLatest.usedBy).toBeUndefined();

    Object.assign(suiLatest, { usedBy: ["a1"] });
    const second = await strategy.decisions.findEntries(context);
    expect(second).toHaveLength(1);
    expect(second[0].accountSlug).toBe("a2");
  });

  it("applies optional inclusive entry bounds, including an active zero maximum", async () => {
    // BOTH:DECISION_V20_LEVEL_GATE
    const decisionsAt = async (
      level: number,
      minEntryAbsLevel?: number,
      maxEntryAbsLevel?: number,
    ) => {
      const context = makeContext(
        ["a1"],
        { SUI: [makePoint(level, 200)] },
        {
          accountTrading: { minEntryAbsLevel, maxEntryAbsLevel },
          tradingMode: "futures",
        },
      );
      return strategy.decisions.findEntries(context);
    };

    expect(await decisionsAt(-1, 2, 3)).toHaveLength(0);
    expect(await decisionsAt(-2, 2, 3)).toHaveLength(1);
    expect(await decisionsAt(3, 2, 3)).toHaveLength(1);
    expect(await decisionsAt(-4, 2, 3)).toHaveLength(0);
    expect(await decisionsAt(0, undefined, 0)).toHaveLength(1);
    expect(await decisionsAt(-1, undefined, 0)).toHaveLength(0);
    expect(await decisionsAt(0, 2, 0)).toHaveLength(0);
    expect(await decisionsAt(0, undefined, undefined)).toHaveLength(1);
    expect(await decisionsAt(-4, undefined, undefined)).toHaveLength(1);
  });

  it("can execute a level-zero entry when its optional bounds permit it", async () => {
    const context = makeContext(
      ["a1"],
      { SUI: [makePoint(0, 200)] },
      {
        accountTrading: {
          enableWatchLogic: false,
          maxEntryAbsLevel: 0,
          minEntryAbsLevel: undefined,
        },
        markPriceMap: { SUI: { lastUpdated: 200, price: 100 } },
        tradingMode: "futures",
      },
    );
    const [decision] = await strategy.decisions.findEntries(context);

    expect(decision).toBeDefined();
    expect(strategy.actions.executeEntry(context, decision)).not.toBeNull();
  });
});

describe("multi strategy late-entry vPoint drift guard", () => {
  // BOTH:LATE_ENTRY_VPOINT_PRICE_DRIFT_PCT — the guard runs identically in
  // every runtime mode because all of them read the current price from
  // state.markPriceMap (the latest closed kline at the runtime clock).
  const driftedContext = (
    price: number,
    accountTrading: Record<string, unknown> = {},
    points: Record<string, VolatilityPoint[]> = {
      SUI: [makePoint(-2, 200)],
    },
  ) =>
    makeContext(["a1"], points, {
      accountTrading,
      currentTime: 200,
      markPriceMap: { SUI: { lastUpdated: 200, price } },
    });

  const entryDecision = (manual = false): RuntimeEntryDecision => ({
    accountSlug: "a1",
    direction: "LONG",
    entrySignal: {
      ...makePoint(-2, 100),
      id: "B_sig1",
      amountProbab: 0.5,
      investAmount: 10,
      maxLeverage: 3,
      message: "decision.v20 LONG: absolute level 2 meets minimum 2",
    },
    ...(manual ? { manual } : {}),
    message: "entry",
    symbol: "SUI",
    type: "entry",
  });

  it("blocks the decision and the plan when the mark drifted past the cap", async () => {
    // p=100 -> mark 102: +2% LONG drift vs the 1% cap at threshold 5.
    const point = makePoint(-2, 200);
    const context = driftedContext(102, {}, { SUI: [point] });

    expect(await strategy.decisions.findEntries(context)).toHaveLength(0);

    // A blocked decision never consumes the source vPoint, so the same
    // point can still enter later if the drift settles back under the cap.
    expect(point.usedBy).toBeUndefined();
    context.state.markPriceMap.SUI.price = 100.5;
    expect(await strategy.decisions.findEntries(context)).toHaveLength(1);

    // The final execution check re-runs the guard on the freshest mark.
    const drifted = driftedContext(102);
    expect(
      strategy.actions.executeEntry(drifted, entryDecision()),
    ).toBeNull();
  });

  it("blocks a SHORT signal symmetrically", async () => {
    // T point p=100 -> mark 98: +2% SHORT-side drift vs the 1% cap.
    const context = makeContext(
      ["a1"],
      { SUI: [makePoint(3, 200)] },
      {
        currentTime: 200,
        markPriceMap: { SUI: { lastUpdated: 200, price: 98 } },
        tradingMode: "futures",
      },
    );
    expect(await strategy.decisions.findEntries(context)).toHaveLength(0);
  });

  it("allows adverse drift and the exact cap boundary", async () => {
    // -1% adverse drift is never blocked.
    expect(
      await strategy.decisions.findEntries(driftedContext(99)),
    ).toHaveLength(1);
    // Exactly +1.0% equals the cap; the boundary stays allowed.
    expect(
      await strategy.decisions.findEntries(driftedContext(101)),
    ).toHaveLength(1);
  });

  it("respects the per-account disable flag and missing marks", async () => {
    const disabled = driftedContext(102, {
      lateEntryVPointPriceDriftEnabled: false,
    });
    expect(await strategy.decisions.findEntries(disabled)).toHaveLength(1);

    // No mark price means no drift signal: the decision is still emitted
    // and the execution plan falls back to MARK_PRICE_UNAVAILABLE.
    const noMark = makeContext(["a1"], { SUI: [makePoint(-2, 200)] });
    expect(await strategy.decisions.findEntries(noMark)).toHaveLength(1);
  });

  it("exempts operator-forced manual entries at execution", () => {
    const context = driftedContext(102);
    const position = strategy.actions.executeEntry(
      context,
      entryDecision(true),
    );
    expect(position).not.toBeNull();
    expect(position?.opened.price).toBe(102);
  });
});

function makePosition(): Position {
  return {
    account: "a1",
    symbol: "SUI",
    executionMode: "sandbox",
    tradingMode: TradingMode.SPOT,
    direction: "LONG",
    opened: {
      t: 0,
      vPoint: { id: "B_open", lvl: -1 },
      reason: "COMMON",
      message: "entry",
      price: 100,
    },
    exposure: {
      averageEntryPrice: 100,
      quantity: 1,
      notionalUsdt: 100,
      marginUsdt: 100,
      leverage: 1,
    },
    fees: {
      entryUsdt: 0,
    },
    strategy: {
      entry: { engine: "decision.v20" },
      averaging: {
        entryLevel: -1,
        lastHandledLevel: -1,
        reserveBaseMarginUsdt: 0,
        reservedRemainingMarginUsdt: 0,
        steps: [],
      },
    },
    pnl: {
      history: [],
    },
  };
}

describe("multi strategy positions", () => {
  it("updates floating PnL, fee estimate, history, and extrema", () => {
    const position = makePosition();
    const context = makeContext(
      ["a1"],
      { SUI: [] },
      {
        currentTime: 5_000,
        markPriceMap: { SUI: { lastUpdated: 5_000, price: 110 } },
        roundTripFeeRate: 0.002,
      },
    );

    strategy.positions.updatePnl(context, position);

    expect(position.pnl.netPct).toBe(9.8);
    expect(position.pnl.netUsdt).toBe(9.8);
    expect(position.pnl.currentValueUsdt).toBe(109.8);
    expect(position.pnl.markPrice).toBe(110);
    expect(position.fees.entryUsdt).toBe(0);
    expect(position.fees.estimatedExitUsdt).toBe(0.2);
    expect(position.pnl.history).toEqual([{ t: 5_000, pct: 9.8 }]);
    expect(position.pnl.maxUpPct).toBe(9.8);
    expect(position.pnl.maxDownPct).toBe(9.8);
    expect(position.pnl.maxUpUsdt).toBe(9.8);
    expect(position.pnl.maxDownUsdt).toBe(9.8);
  });

  it("classifies a position above the positive PnL threshold as speedup", () => {
    const position = makePosition();
    const context = makeContext(
      ["a1"],
      { SUI: [] },
      {
        currentTime: 5_000,
        markPriceMap: { SUI: { lastUpdated: 5_000, price: 110 } },
        roundTripFeeRate: 0.002,
        takeProfitPercent: 50,
      },
    );
    strategy.positions.updatePnl(context, position);

    strategy.positions.updateMonitoringStage(context, position);

    expect(position.lastMonitoringStage).toEqual({
      lastUpdated: 5_000,
      reason: "positive PnL threshold",
      stage: "speedup",
    });
  });

  it("marks the shared source point used only for the acting account", async () => {
    const suiLatest = makePoint(-3, 200);
    const points = {
      BTC: [makePoint(-3, 200)],
      SUI: [suiLatest],
    };
    const context = makeContext(["a1", "a2"], points);
    const recommendation: EntryRecommendation = {
      ...suiLatest,
      amountProbab: 0.5,
      maxLeverage: 3,
      message: "decision.v20 LONG: absolute level 3 meets minimum 2",
    };

    strategy.positions.markVPointUsed({
      accountSlug: "a1",
      recommendation,
      volatilityPoints: points.SUI,
    });

    expect(suiLatest.usedBy).toEqual(["a1"]);
    expect(suiLatest.used).toBeUndefined();

    const decisions = await strategy.decisions.findEntries(context);
    expect(decisions.map((decision) => decision.accountSlug)).toEqual(["a2"]);
  });
});

describe("multi strategy averaging", () => {
  it("recommends averaging only on a deeper actionable level", async () => {
    const position = makePosition();
    position.strategy.averaging.steps.push({
      allocationPct: 2,
      level: -2,
      marginUsdt: 40,
      status: "RESERVED",
    });
    position.strategy.averaging.reservedRemainingMarginUsdt = 40;

    const context = makeContext(
      ["a1"],
      { SUI: [makePoint(-2, 100)] },
      {},
    );
    const decision = await strategy.decisions.findAveraging(
      context,
      position,
    );

    expect(decision).not.toBeNull();
    expect(decision?.type).toBe("averaging");
    expect(decision?.accountSlug).toBe("a1");
    expect(decision?.symbol).toBe("SUI");
    expect(decision?.position).toBe(position);
    expect(decision?.recommendation.investAmount).toBe(40);
    expect(decision?.recommendation.maxLeverage).toBe(1);
    expect(decision?.message).toBe("Averaging LONG for SUI at level -2");

    // Absolute level 1 stays observation-only for averaging.
    const shallowContext = makeContext(
      ["a1"],
      { SUI: [makePoint(-1, 100)] },
      {},
    );
    await expect(
      strategy.decisions.findAveraging(shallowContext, position),
    ).resolves.toBeNull();
  });

  it("executes a simulated averaging fill on a cloned position", () => {
    const position = makePosition();
    position.lastMonitoringStage = {
      lastUpdated: 1,
      reason: "standard reason",
      stage: "standard",
    };
    position.strategy.averaging.steps.push({
      allocationPct: 2,
      level: -2,
      marginUsdt: 50,
      status: "RESERVED",
    });
    position.strategy.averaging.reservedRemainingMarginUsdt = 50;

    const context = makeContext(
      ["a1"],
      { SUI: [] },
      {
        accountTrading: { averagingRescueProjectionGuardEnabled: false },
        currentTime: 5_000,
        feeRate: 0.001,
        markPriceMap: { SUI: { lastUpdated: 5_000, price: 95 } },
      },
    );
    context.state.balance.a1.available = 1_000;
    context.state.balance.a1.reserved = 50;
    context.state.balance.a1.spendable = 950;

    const decision = {
      accountSlug: "a1",
      message: "Averaging LONG for SUI at level -2",
      position,
      recommendation: {
        ...makePoint(-2, 100),
        investAmount: 50,
        maxLeverage: 1,
        message: "Averaging LONG for SUI at level -2",
        p: 110,
      },
      symbol: "SUI",
      type: "averaging" as const,
    };
    const nextPosition = strategy.actions?.executeAveraging(
      context,
      decision,
    );

    expect(nextPosition).not.toBeNull();
    if (!nextPosition) return;

    // Input position is cloned, not mutated.
    expect(position.exposure.quantity).toBe(1);
    expect(position.exposure.marginUsdt).toBe(100);
    expect(position.fees.entryUsdt).toBe(0);
    expect(position.strategy.averaging.steps[0].status).toBe("RESERVED");

    // Added fill: 50 margin at 95 on spot => 0.526315 quantity.
    expect(nextPosition.exposure.quantity).toBeCloseTo(1.526315789, 6);
    expect(nextPosition.exposure.notionalUsdt).toBe(150);
    expect(nextPosition.exposure.marginUsdt).toBe(150);
    expect(nextPosition.exposure.averageEntryPrice).toBeCloseTo(
      98.275862,
      6,
    );

    // Fee comes through the adapter exchange port.
    expect(nextPosition.fees.entryUsdt).toBeCloseTo(0.05, 6);
    expect(nextPosition.fees.estimatedExitUsdt).toBeCloseTo(0.15, 6);

    // Execution record carries the fill and frozen monitoring snapshot.
    const executions = nextPosition.strategy.averaging.executions ?? [];
    expect(executions).toHaveLength(1);
    expect(executions[0]).toMatchObject({
      allocationPct: 2,
      level: -2,
      marginUsdt: 50,
      monitoringState: {
        lastUpdated: 1,
        reason: "standard reason",
        stage: "standard",
      },
      price: 95,
      reservedMarginUsdt: 50,
      t: 5_000,
    });

    // The consumed step is marked USED and the reserve is recomputed.
    expect(nextPosition.strategy.averaging.steps[0]).toMatchObject({
      status: "USED",
      usedAt: 5_000,
      usedPrice: 95,
    });
    expect(
      nextPosition.strategy.averaging.reservedRemainingMarginUsdt,
    ).toBe(0);
    expect(nextPosition.strategy.averaging.lastHandledLevel).toBe(-2);
  });
});

describe("multi strategy entry action", () => {
  it("builds an exact spot position without mutating runtime state", () => {
    const context = makeContext(
      ["a1"],
      { SUI: [] },
      {
        accountTrading: { enableWatchLogic: false },
        currentTime: 5_000,
        markPriceMap: { SUI: { lastUpdated: 5_000, price: 100 } },
      },
    );
    const signal: EntryRecommendation = {
      ...makePoint(-2, 100),
      id: "B_sig1",
      amountProbab: 0.5,
      investAmount: 10,
      maxLeverage: 3,
      message: "decision.v20 LONG: absolute level 2 meets minimum 2",
    };

    const position = strategy.actions.executeEntry(context, {
      accountSlug: "a1",
      direction: "LONG",
      entrySignal: signal,
      message: signal.message,
      symbol: "SUI",
      type: "entry",
    });

    expect(position).not.toBeNull();
    if (!position) return;

    expect(position.account).toBe("a1");
    expect(position.symbol).toBe("SUI");
    expect(position.executionMode).toBe("sandbox");
    expect(position.tradingMode).toBe(TradingMode.SPOT);
    expect(position.direction).toBe("LONG");
    expect(position.opened).toEqual({
      t: 5_000,
      vPoint: { id: "B_sig1", lvl: -2 },
      reason: "COMMON",
      message: signal.message,
      price: 100,
    });
    expect(position.exposure).toEqual({
      averageEntryPrice: 100,
      quantity: 0.1,
      notionalUsdt: 10,
      marginUsdt: 10,
      leverage: 1,
    });
    expect(position.fees.entryUsdt).toBe(0);
    expect(position.fees.estimatedExitUsdt).toBe(0);
    expect(position.strategy.averaging).toEqual({
      entryLevel: -2,
      lastHandledLevel: -2,
      // Legacy records the executed margin as the empty-state reserve base.
      reserveBaseMarginUsdt: 10,
      reservedRemainingMarginUsdt: 0,
      steps: [],
    });
    expect(position.strategy.entry.engine).toBe("decision.v20");
    expect(position.pnl).toEqual({
      currentValueUsdt: 10,
      history: [{ t: 5_000, pct: 0 }],
      markPrice: 100,
      maxDownPct: 0,
      maxDownUsdt: 0,
      maxUpPct: 0,
      maxUpUsdt: 0,
      netPct: 0,
      netUsdt: 0,
    });

    // The action returns a new position; accounting stays with monitoring.
    expect(context.state.openPositions).toHaveLength(0);
    expect(context.state.balance.a1).toMatchObject({
      available: 100,
      locked: 0,
      reserved: 0,
      spendable: 100,
      total: 100,
    });
  });

  it("caps futures leverage and projects the reserve ladder", () => {
    const context = makeContext(
      ["a1"],
      { SUI: [] },
      {
        accountTrading: {
          maxLeverage: 2,
          watchReserveLevels: 1,
          watchReservePctAlloc: 2,
        },
        currentTime: 5_000,
        markPriceMap: { SUI: { lastUpdated: 5_000, price: 100 } },
        tradingMode: TradingMode.FUTURES,
      },
    );
    context.state.balance.a1.available = 200;
    context.state.balance.a1.spendable = 200;
    context.state.balance.a1.total = 200;
    const signal: EntryRecommendation = {
      ...makePoint(-2, 100),
      id: "B_fut1",
      amountProbab: 1,
      investAmount: 20,
      maxLeverage: 3,
      message: "decision.v20 LONG: absolute level 2 meets minimum 2",
    };

    const position = strategy.actions.executeEntry(context, {
      accountSlug: "a1",
      direction: "LONG",
      entrySignal: signal,
      message: signal.message,
      symbol: "SUI",
      type: "entry",
    });

    expect(position).not.toBeNull();
    if (!position) return;

    // mapScaleValue gives 4, engine cap 3, config cap wins at 2.
    expect(position.exposure.leverage).toBe(2);
    expect(position.exposure.marginUsdt).toBe(20);
    expect(position.exposure.notionalUsdt).toBe(40);
    expect(position.exposure.quantity).toBeCloseTo(0.4, 6);
    expect(position.tradingMode).toBe(TradingMode.FUTURES);
    expect(position.strategy.averaging).toEqual({
      entryLevel: -2,
      lastHandledLevel: -2,
      reserveBaseMarginUsdt: 20,
      reservedRemainingMarginUsdt: 40,
      steps: [
        {
          allocationPct: 2,
          level: -3,
          marginUsdt: 40,
          status: "RESERVED",
        },
      ],
    });
    expect(context.state.balance.a1.available).toBe(200);
  });
});

describe("multi strategy exit", () => {
  it("force exit sells the position and cleans the control flag", async () => {
    const position = makePosition();
    position.control = { forceExit: { reason: "manual stop requested" } };
    const context = makeContext(
      ["a1"],
      { SUI: [makePoint(-1, 0)] },
      {
        currentTime: 5_000,
        markPriceMap: { SUI: { lastUpdated: 5_000, price: 90 } },
      },
    );

    const decision = await strategy.decisions.findExit(context, position);

    expect(decision).not.toBeNull();
    if (!decision) return;
    expect(decision.type).toBe("exit");
    expect(decision.symbol).toBe("SUI");
    expect(decision.accountSlug).toBe("a1");
    expect(decision.tradeDecision.action).toBe("SELL");
    expect(decision.tradeDecision.category).toBe("[FINAL_SELL]");
    expect(decision.tradeDecision.emailNotif).toBe("[SELL] FINAL SELL");
    expect(decision.tradeDecision.price).toBe(90);
    expect(decision.tradeDecision.amount).toBe(1);
    expect(decision.tradeDecision.profit).toBeCloseTo(-0.1, 6);

    const executed = strategy.actions.executeExit(context, decision);

    expect(executed).not.toBeNull();
    if (!executed) return;
    const closed = executed.closed;
    expect(closed).toBeDefined();
    if (!closed) return;
    expect(closed.reason).toBe("FORCED");
    expect(closed.source).toBeUndefined();
    expect(closed.t).toBe(5_000);
    expect(closed.price).toBe(90);
    expect(closed.feeUsdt).toBe(0);
    expect(closed.message).toContain("FINAL SELL");
    expect(closed.message).toContain("manual stop requested");
    expect(executed.pnl.netPct).toBeCloseTo(-10, 6);
    expect(executed.pnl.netUsdt).toBeCloseTo(-10, 6);
    expect(executed.pnl.currentValueUsdt).toBeCloseTo(90, 6);
    // The closed clone carries no leftover control flag.
    expect(executed.control).toBeUndefined();
    // Evaluating/executing never mutates the original open position.
    expect(position.closed).toBeUndefined();
    expect(position.control?.forceExit?.reason).toBe(
      "manual stop requested",
    );
  });

  it("hard percent stop loss closes below the configured boundary", async () => {
    const position = makePosition();
    const context = makeContext(
      ["a1"],
      { SUI: [makePoint(-1, 0)] },
      {
        accountTrading: { stopLossPercent: 5, stopLossUSDT: 0 },
        currentTime: 5_000,
        markPriceMap: { SUI: { lastUpdated: 5_000, price: 90 } },
      },
    );

    const decision = await strategy.decisions.findExit(context, position);

    expect(decision).not.toBeNull();
    if (!decision) return;
    expect(decision.tradeDecision.action).toBe("SELL");
    expect(decision.tradeDecision.category).toBe("[STOP_LOSS]");

    const executed = strategy.actions.executeExit(context, decision);

    expect(executed).not.toBeNull();
    if (!executed) return;
    expect(executed.closed?.reason).toBe("STOP_LOSS");
    expect(executed.pnl.netPct).toBeCloseTo(-10, 6);
    expect(executed.pnl.netUsdt).toBeCloseTo(-10, 6);
    expect(position.closed).toBeUndefined();
  });

  it("takes profit once the post-entry volatility target zone is hit", async () => {
    const position = makePosition();
    position.fees.estimatedExitUsdt = 0.5;
    const entryPoint: VolatilityPoint = {
      ...makePoint(-1, 0),
      id: "B_open",
      p: 100,
    };
    const intermediatePoint: VolatilityPoint = {
      ...makePoint(-2, 50),
      id: "B_mid",
      p: 98,
    };
    const targetPoint: VolatilityPoint = {
      ...makePoint(1, 100),
      id: "T_target",
      p: 110,
    };
    const context = makeContext(
      ["a1"],
      { SUI: [entryPoint, intermediatePoint, targetPoint] },
      {
        accountTrading: { stopLossUSDT: 0 },
        currentTime: 5_000,
        markPriceMap: { SUI: { lastUpdated: 5_000, price: 110 } },
      },
    );

    const decision = await strategy.decisions.findExit(context, position);

    expect(decision).not.toBeNull();
    if (!decision) return;
    expect(decision.tradeDecision.action).toBe("SELL");
    expect(decision.tradeDecision.category).toBe("[TAKE_PROFIT]");

    const executed = strategy.actions.executeExit(context, decision);

    expect(executed).not.toBeNull();
    if (!executed) return;
    expect(executed.closed?.reason).toBe("VOLATILITY_TARGET_TP");
    expect(executed.closed?.vPoint).toEqual({ id: "T_target", lvl: 1 });
    // Intermediate path excludes the entry and closing vPoints.
    expect(executed.vPoints).toEqual([{ id: "B_mid", lvl: -2 }]);
    expect(executed.fees.estimatedExitUsdt).toBeUndefined();
    expect(executed.closed?.t).toBe(5_000);
    expect(executed.closed?.price).toBe(110);
    expect(executed.closed?.feeUsdt).toBe(0);
    expect(executed.pnl.netPct).toBeCloseTo(10, 6);
    expect(position.closed).toBeUndefined();

    // Adjacent entry/exit points still yield an explicit empty path.
    context.state.vPointsMap.SUI = [entryPoint, targetPoint];
    const adjacentDecision = await strategy.decisions.findExit(
      context,
      position,
    );
    expect(adjacentDecision).not.toBeNull();
    if (!adjacentDecision) return;
    const adjacentExecuted = strategy.actions.executeExit(
      context,
      adjacentDecision,
    );
    expect(adjacentExecuted?.vPoints).toEqual([]);
  });

  it("stop loss plus exits once the recorded peak retraces past the trigger", async () => {
    // BOTH:SL_PLUS — the trailing peak is the persisted pnl.maxUpPct, which
    // updatePnl refreshes before every exit evaluation in every mode.
    const position = makePosition();
    position.pnl.maxUpPct = 1.5;
    const context = makeContext(
      ["a1"],
      { SUI: [makePoint(-1, 0)] },
      {
        accountTrading: {
          stopLossPlusTrigger: 0.5,
          takeProfitPercent: 1,
          useStopLossPlus: true,
        },
        currentTime: 5_000,
        markPriceMap: { SUI: { lastUpdated: 5_000, price: 100.9 } },
      },
    );

    // Net +0.9% vs recorded peak +1.5% -> -0.6pp retrace > 0.5 trigger.
    const decision = await strategy.decisions.findExit(context, position);

    expect(decision).not.toBeNull();
    if (!decision) return;
    expect(decision.tradeDecision.action).toBe("SELL");
    expect(decision.tradeDecision.category).toBe("[STOP_LOSS_PLUS_TP]");
    expect(decision.tradeDecision.reason).toContain("Peak 1.50%");

    const executed = strategy.actions.executeExit(context, decision);

    expect(executed).not.toBeNull();
    if (!executed) return;
    expect(executed.closed?.reason).toBe("STOP_LOSS_PLUS_TP");
    expect(executed.closed?.price).toBe(100.9);
    expect(executed.pnl.netPct).toBeCloseTo(0.9, 6);
    expect(position.closed).toBeUndefined();
  });

  it("stop loss plus holds while the retrace stays inside the trigger", async () => {
    const position = makePosition();
    position.pnl.maxUpPct = 1.5;
    const context = makeContext(
      ["a1"],
      { SUI: [makePoint(-1, 0)] },
      {
        accountTrading: {
          stopLossPlusTrigger: 0.5,
          takeProfitPercent: 1,
          useStopLossPlus: true,
        },
        currentTime: 5_000,
        markPriceMap: { SUI: { lastUpdated: 5_000, price: 101.3 } },
      },
    );

    // Net +1.3% -> -0.2pp retrace stays inside the 0.5 trigger.
    expect(await strategy.decisions.findExit(context, position)).toBeNull();
  });

  it("stop loss plus stays disarmed before the take-profit peak", async () => {
    const position = makePosition();
    // Peak 0.8% never reached TP 1%, so a big drawdown still cannot trigger.
    position.pnl.maxUpPct = 0.8;
    const context = makeContext(
      ["a1"],
      { SUI: [makePoint(-1, 0)] },
      {
        accountTrading: {
          stopLossPlusTrigger: 0.5,
          takeProfitPercent: 1,
          useStopLossPlus: true,
        },
        currentTime: 5_000,
        markPriceMap: { SUI: { lastUpdated: 5_000, price: 100.1 } },
      },
    );

    // Net +0.1% -> -0.7pp from peak would exceed the trigger if armed.
    expect(await strategy.decisions.findExit(context, position)).toBeNull();
  });
});
