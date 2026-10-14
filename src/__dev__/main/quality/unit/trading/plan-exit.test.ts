import { describe, expect, it } from "vitest";

import type { RuntimeContext, RuntimeEngineState } from "@/lib/precision/types";
import type { Position, PositionPlan } from "@/lib/system/trading";
import tradingExit from "@/lib/system/trading/exit";
import planExit from "@/lib/system/trading/plan-exit";

import { createTestPosition } from "../../fixtures/position";

const NOW = Date.UTC(2026, 9, 14, 12, 0);

function makeContext(mark: number, currentTime = NOW): RuntimeContext {
  const state = {
    config: {
      accounts: [
        {
          enabled: true,
          slug: "binance-1",
          // Wide account rules so only the plan can close the position.
          trading: { stopLossPercent: 90, stopLossUSDT: 0, takeProfitPercent: 90, useStopLossPlus: false },
        },
      ],
      management: { exchangeType: "binance", symbols: ["SUI"], tradingMode: "futures" },
      runtime: {},
    },
    currentTime,
    markPriceMap: { SUI: { lastUpdated: currentTime, price: mark } },
    mode: "backtest",
    openPositions: [],
    vPointsMap: {},
  } as unknown as RuntimeEngineState;
  return {
    adapter: { exchange: { getFeeRate: () => 0.001, getRoundTripFeeRate: () => 0.002 } },
    helper: {
      getAccountConfig: (slug: string) =>
        state.config.accounts.find((account) => account.slug === slug)?.trading ?? {},
    },
    state,
  } as unknown as RuntimeContext;
}

function planned(plan: PositionPlan, direction: Position["direction"] = "LONG"): Position {
  const position = createTestPosition({ direction, entryPrice: 100, quantity: 1, notionalUsdt: 100 });
  position.strategy.plan = plan;
  return position;
}

describe("strategy plan exit levels", () => {
  // BOTH:STRATEGY_PLAN_EXIT — absolute TP/SL prices and a timeout set by the
  // strategy at entry; the shared exit path enforces them in every mode.

  it("closes a LONG at TP once the mark reaches it, and at SL below it", () => {
    const plan = { sl: 95, tp: 110 };
    expect(planExit.evaluate({ direction: "LONG", plan, price: 109.9, t: NOW })).toBeNull();
    expect(planExit.evaluate({ direction: "LONG", plan, price: 110, t: NOW })).toEqual({ level: 110, reason: "PLAN_TP" });
    expect(planExit.evaluate({ direction: "LONG", plan, price: 95, t: NOW })).toEqual({ level: 95, reason: "PLAN_SL" });
  });

  it("mirrors the levels for a SHORT", () => {
    const plan = { sl: 105, tp: 90 };
    expect(planExit.evaluate({ direction: "SHORT", plan, price: 95, t: NOW })).toBeNull();
    expect(planExit.evaluate({ direction: "SHORT", plan, price: 89, t: NOW })?.reason).toBe("PLAN_TP");
    expect(planExit.evaluate({ direction: "SHORT", plan, price: 105.5, t: NOW })?.reason).toBe("PLAN_SL");
  });

  it("times out at exp and prefers SL when a mis-ordered plan hits both prices", () => {
    expect(planExit.evaluate({ direction: "LONG", plan: { exp: NOW }, price: 100, t: NOW - 1 })).toBeNull();
    expect(planExit.evaluate({ direction: "LONG", plan: { exp: NOW }, price: 100, t: NOW })?.reason).toBe("PLAN_TIMEOUT");
    expect(planExit.evaluate({ direction: "LONG", plan: { sl: 101, tp: 99 }, price: 100, t: NOW })?.reason).toBe("PLAN_SL");
  });

  it("drops unusable levels and stores no empty plan", () => {
    expect(planExit.normalize({ exp: Number.NaN, sl: 0, tp: 110 })).toEqual({ tp: 110 });
    expect(planExit.normalize({ sl: -1 })).toBeUndefined();
    expect(planExit.normalize(undefined)).toBeUndefined();
  });

  it("sells the whole position at the mark through the shared exit path", async () => {
    const position = planned({ sl: 95, tp: 110 });

    expect(await tradingExit.findDecision(makeContext(105), position)).toBeNull();

    const decision = await tradingExit.findDecision(makeContext(111), position);
    expect(decision?.tradeDecision.action).toBe("SELL");
    expect(decision?.tradeDecision.amount).toBe(1);
    expect(decision?.tradeDecision.position?.closed).toMatchObject({ price: 111, reason: "PLAN_TP", t: NOW });
    // The evaluated position is a clone — the open one stays open.
    expect(position.closed).toBeUndefined();
  });

  it("closes on the first pass after the timeout regardless of price", async () => {
    const position = planned({ exp: NOW });
    const decision = await tradingExit.findDecision(makeContext(100, NOW + 60_000), position);
    expect(decision?.tradeDecision.position?.closed?.reason).toBe("PLAN_TIMEOUT");
  });

  it("leaves positions without a plan to the account rules", async () => {
    const position = createTestPosition({ entryPrice: 100, quantity: 1, notionalUsdt: 100 });
    expect(await tradingExit.findDecision(makeContext(111), position)).toBeNull();
  });
});
