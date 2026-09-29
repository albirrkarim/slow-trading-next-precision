import { describe, expect, it } from "vitest";
import { TradingMode } from "@/lib/exchange/types";
import type { RuntimeEffectiveConfig } from "@/lib/system/runtime";
import pair from "@/lib/strategies/shared/pair";
import {
  runtimeEntrySequences,
  runtimeWorkerCapacity,
} from "@/lib/system/trading";
import type {
  EntryRecommendation,
  Position,
} from "@/lib/system/trading";
import type { VolatilityPoint } from "@/lib/system/types";

function vPoint(lvl: number, t: number, id: string): VolatilityPoint {
  return {
    id,
    l: lvl < 0 ? "B" : "T",
    lvl,
    p: 1,
    pct: 1,
    t,
    vb: 1,
    vq: 1,
  } as VolatilityPoint;
}

const estimateConfig = {
  enableWatchLogic: true,
  entrySpareBufferEnabled: true,
  exactLeverage: 3,
  maxEntryBased24HourVolPct: 20,
  maxEntryMargin: 100,
  takeProfitPercent: 2,
  tradingMode: TradingMode.FUTURES,
  watchReserveLevels: 2,
  watchReservePctAlloc: 2,
} as RuntimeEffectiveConfig;

const volatilityMap = {
  SUI: [vPoint(4, 1000, "vp-1"), vPoint(0, 2000, "vp-2")],
};

const entrySignals = [
  {
    amountProbab: 1,
    id: "vp-1",
    l: "T",
    lvl: 4,
    maxLeverage: 10,
    symbol: "SUI",
    t: 1000,
  } as EntryRecommendation,
];

function estimate(legsPerWorker?: number) {
  return runtimeEntrySequences.systemCapacity.estimate({
    config: estimateConfig,
    endTimeMs: 2000,
    entrySignals,
    legsPerWorker,
    startTimeMs: 1000,
    volatilityMap,
    volume24hBySymbol: { SUI: 100000 },
  });
}

const capacityConfig = {
  enableWatchLogic: true,
  entrySpareBufferEnabled: true,
  maxEntryMargin: 100,
  maxOpenPositions: 10,
  watchReserveLevels: 2,
  watchReservePctAlloc: 2,
};

function capacity(extra: {
  legsPerWorker?: number;
  openWorkers?: number;
  positionCount?: number;
}) {
  const activePositions = Array.from(
    { length: extra.positionCount ?? 0 },
    () =>
      ({ strategy: { averaging: { steps: [] } } }) as unknown as Pick<
        Position,
        "strategy"
      >,
  );
  return runtimeWorkerCapacity.calculate({
    activePositions,
    config: capacityConfig,
    legsPerWorker: extra.legsPerWorker,
    openWorkers: extra.openWorkers,
    spendableUsdt: 10000,
  });
}

describe("pair leg helpers", () => {
  it("detects pair mode for both/streak on an entryLegs-BOTH account", () => {
    expect(pair.isPairMode({})).toBe(false);
    expect(pair.isPairMode({ entryLegs: "BOTH" })).toBe(false);
    expect(pair.isPairMode({ strategy: "both" })).toBe(true);
    expect(pair.isPairMode({ strategy: "both", entryLegs: "BOTH" })).toBe(true);
    expect(pair.isPairMode({ strategy: "both", entryLegs: "MAIN" })).toBe(false);
    expect(pair.isPairMode({ strategy: "streak" })).toBe(true);
    expect(
      pair.isPairMode({ strategy: "streak", entryLegs: "COUNTER" }),
    ).toBe(false);
    expect(
      pair.isPairMode({ strategy: "custom_swe_2_profit_rail_v1" }),
    ).toBe(true);
    expect(
      pair.isPairMode({
        strategy: "custom_swe_2_profit_rail_v1",
        entryLegs: "MAIN",
      }),
    ).toBe(false);
  });

  it("counts two funded legs only in pair mode", () => {
    expect(pair.legsPerWorker({})).toBe(1);
    expect(pair.legsPerWorker({ entryLegs: "BOTH" })).toBe(1);
    expect(pair.legsPerWorker({ strategy: "both" })).toBe(2);
    expect(
      pair.legsPerWorker({ entryLegs: "MAIN", strategy: "both" }),
    ).toBe(1);
    expect(pair.legsPerWorker({ strategy: "streak" })).toBe(2);
    expect(
      pair.legsPerWorker({ entryLegs: "COUNTER", strategy: "streak" }),
    ).toBe(1);
    expect(
      pair.legsPerWorker({ strategy: "custom_swe_2_profit_rail_v1" }),
    ).toBe(2);
  });
});

describe("estimateSystemMaximalCapacity — legsPerWorker", () => {
  it("funds margin and reserve per leg while keeping worker counts and gross TP", () => {
    const single = estimate(1);
    const paired = estimate(2);

    expect(single.sequences).toHaveLength(1);
    expect(paired.sequences).toHaveLength(1);

    // One worker is one pair: its cost and effective capital double,
    // worker counts and the MAIN-leg gross take-profit do not.
    expect(paired.sequences[0].workerCostUsdt).toBe(
      single.sequences[0].workerCostUsdt * 2,
    );
    expect(paired.sequences[0].effectiveCapitalUsdt).toBe(
      single.sequences[0].effectiveCapitalUsdt * 2,
    );
    expect(paired.metrics.maxEffectiveCapitalUsdt).toBe(
      single.metrics.maxEffectiveCapitalUsdt * 2,
    );
    expect(paired.metrics.totalEntryMarginUsdt).toBe(
      single.metrics.totalEntryMarginUsdt * 2,
    );
    expect(paired.metrics.totalWorkerCostUsdt).toBe(
      single.metrics.totalWorkerCostUsdt * 2,
    );
    expect(paired.metrics.maxProfitUsdt).toBe(single.metrics.maxProfitUsdt);
    expect(paired.metrics.sequenceCount).toBe(single.metrics.sequenceCount);
    expect(paired.metrics.maxWorkers).toBe(single.metrics.maxWorkers);
    expect(paired.metrics.minWorkers).toBe(single.metrics.minWorkers);
    expect(paired.metrics.avgWorkers).toBe(single.metrics.avgWorkers);
  });

  it("reproduces the single-leg output by default", () => {
    expect(estimate()).toEqual(estimate(1));
    expect(estimate(0)).toEqual(estimate(1));
  });
});

describe("calculateRuntimeWorkerCapacity — legsPerWorker/openWorkers", () => {
  it("doubles the worker cost and halves affordable workers in pair mode", () => {
    const single = capacity({ legsPerWorker: 1 });
    const paired = capacity({ legsPerWorker: 2 });

    // Per-leg entry margin is unchanged; the worker cost funds both legs.
    expect(paired.entryMarginUsdt).toBe(single.entryMarginUsdt);
    expect(paired.workerCostUsdt).toBe(single.workerCostUsdt * 2);
    expect(paired.balanceAvailableWorkers).toBe(
      Math.floor(single.entryBudgetUsdt / paired.workerCostUsdt),
    );
    expect(paired.balanceAvailableWorkers).toBeLessThan(
      single.balanceAvailableWorkers,
    );
  });

  it("reproduces the single-leg output by default", () => {
    expect(capacity({})).toEqual(capacity({ legsPerWorker: 1 }));
  });

  it("uses openWorkers for the open-slot count instead of raw positions", () => {
    const raw = capacity({ positionCount: 3 });
    const collapsed = capacity({ openWorkers: 1, positionCount: 3 });

    expect(raw.currentOpenPositions).toBe(3);
    expect(raw.remainingPositionSlots).toBe(7);
    expect(collapsed.currentOpenPositions).toBe(1);
    expect(collapsed.remainingPositionSlots).toBe(9);
  });
});
