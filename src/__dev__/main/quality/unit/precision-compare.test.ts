import {
  buildPrecisionPositionKey,
  comparePrecisionRuns,
} from "@/lib/precision/compare";
import type {
  PrecisionBacktestResultV1,
  PrecisionPositionV1,
  ProdTestCaseV1,
} from "@/lib/precision/types";

const BASE_TIME = Date.UTC(2026, 5, 1, 0, 0, 0);

/** Builds one minimal canonical position. */
function makePosition(
  overrides: Partial<PrecisionPositionV1>,
): PrecisionPositionV1 {
  return {
    account: "main-account",
    symbol: "SUI",
    direction: "LONG",
    opened: {
      t: BASE_TIME,
      reason: "COMMON",
      message: "test",
      price: 100,
      vPoint: { id: "B_abc_01_02_26_00_00", lvl: 3 },
    },
    strategyId: "multi",
    ...overrides,
  } as PrecisionPositionV1;
}

/** Builds one minimal run around its positions. */
function makeRun(
  mode: "live" | "backtest",
  positions: PrecisionPositionV1[],
): ProdTestCaseV1 | PrecisionBacktestResultV1 {
  return {
    schema: 1,
    strategy: "multi",
    mode,
    account: "main-account",
    startTime: BASE_TIME,
    endTime: BASE_TIME + 3_600_000,
    config: { runtime: {} as never, trading: {} as never },
    initialState: {} as never,
    sharedVolatility: {},
    endPositions: positions,
  };
}

describe("precision comparison", () => {
  it("pairs positions by account, symbol, direction, vPoint id, and role", () => {
    const position = makePosition({});
    expect(buildPrecisionPositionKey(position)).toBe(
      "main-account|SUI|LONG|B_abc_01_02_26_00_00|MAIN",
    );
    expect(buildPrecisionPositionKey({ ...position, role: "COUNTER" })).toBe(
      "main-account|SUI|LONG|B_abc_01_02_26_00_00|COUNTER",
    );
    expect(
      buildPrecisionPositionKey({
        ...position,
        symbol: "sui",
        opened: { t: 0, reason: "COMMON", message: "test", price: 100, vPoint: { id: "", lvl: 0 } },
      }),
    ).toBe("main-account|SUI|LONG||MAIN");
  });

  it("scores equal leaves and excludes only executionMode", () => {
    const production = makePosition({
      executionMode: "live",
      pnl: { netPct: 1.5 },
    } as Partial<PrecisionPositionV1>);
    const backtest = makePosition({
      executionMode: "sandbox",
      pnl: { netPct: 1.5 },
    } as Partial<PrecisionPositionV1>);

    // TC: BOTH:PRODUCTION_BACKTEST_POSITION_COMPARISON
    const result = comparePrecisionRuns({
      production: makeRun("live", [production]) as ProdTestCaseV1,
      backtest: makeRun("backtest", [backtest]) as PrecisionBacktestResultV1,
    });
    expect(result.valid).toBe(true);
    expect(result.pairCount).toBe(1);
    expect(result.overallPrecisionPct).toBe(100);
    expect(result.pairs[0].differences).toHaveLength(0);
  });

  it("reports numeric differences with absolute and percentage gaps", () => {
    const production = makePosition({
      pnl: { netPct: 10 },
    } as Partial<PrecisionPositionV1>);
    const backtest = makePosition({
      pnl: { netPct: 8 },
    } as Partial<PrecisionPositionV1>);

    const result = comparePrecisionRuns({
      production: makeRun("live", [production]) as ProdTestCaseV1,
      backtest: makeRun("backtest", [backtest]) as PrecisionBacktestResultV1,
    });
    expect(result.pairs[0].differences).toHaveLength(1);
    const difference = result.pairs[0].differences[0];
    expect(difference.absGap).toBe(2);
    expect(difference.pctGap).toBe(20);
  });

  it("refuses scoring when runs are not comparable", () => {
    const production = makeRun("live", [makePosition({})]) as ProdTestCaseV1;
    const backtest = makeRun("backtest", [makePosition({})]) as PrecisionBacktestResultV1;
    backtest.startTime = production.startTime + 1;

    // TC: BOTH:PRECISION_MEASUREMENT
    const result = comparePrecisionRuns({ production, backtest });
    expect(result.valid).toBe(false);
    expect(result.mismatches).toContain("startTime");
    expect(result.overallPrecisionPct).toBeNull();
  });

  it("reports unpaired and ambiguous positions without scoring them", () => {
    const shared = makePosition({});
    const productionOnly = makePosition({
      opened: { t: 1, reason: "COMMON", message: "test", price: 100, vPoint: { id: "other", lvl: 3 } },
    });
    const production = makeRun("live", [
      shared,
      shared,
      productionOnly,
    ]) as ProdTestCaseV1;
    const backtest = makeRun("backtest", [
      shared,
    ]) as PrecisionBacktestResultV1;

    const result = comparePrecisionRuns({ production, backtest });
    expect(result.valid).toBe(true);
    expect(result.ambiguousKeys).toHaveLength(1);
    expect(result.ambiguousKeys[0].productionCount).toBe(2);
    expect(result.productionOnly).toHaveLength(1);
    expect(result.backtestOnly).toHaveLength(0);
  });
});
