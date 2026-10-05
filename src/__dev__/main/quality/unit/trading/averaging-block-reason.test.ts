import { describe, expect, it } from "vitest";
import { runtimeDefaults } from "@/lib/system/runtime";
import { TradingMode } from "@/lib/exchange/types";

import type {
  RuntimeAveragingDecision,
  RuntimeContext,
  RuntimeEngineAdapter,
  RuntimeEngineState,
} from "@/lib/precision/types";
import type { RuntimeHelper } from "@/lib/precision/helper/types";
import type {
  AveragingRecommendation,
  Position,
} from "@/lib/system/trading";
import tradingAveraging from "@/lib/system/trading/averaging";

function makeContext(
  options: {
    accountTrading?: Record<string, unknown>;
    available?: number;
    feeRate?: number;
    markPrice?: number;
    reserved?: number;
    spendable?: number;
  } = {},
): RuntimeContext {
  const available = options.available ?? 10;
  const state: RuntimeEngineState = {
    balance: {
      a1: {
        available,
        locked: 0,
        reserved: options.reserved ?? 0,
        safeHaven: 0,
        spendable: options.spendable ?? available,
        startingBalance: available,
        total: available,
      },
    },
    config: {
      accounts: [
        {
          slug: "a1",
          name: "a1",
          type: "binance" as const,
          description: "",
          credentials: { apiKey: "", apiSecret: "" },
          enabled: true,
          trading: {
            ...runtimeDefaults.trading.create(),
            averagingRescueProjectionGuardEnabled: false,
            ...options.accountTrading,
          },
          sandbox: { initialBalanceUSDT: available },
          createdAt: 0,
          updatedAt: 0,
        },
      ],
      management: {
        ...runtimeDefaults.management.create(),
        name: "test",
        description: "test",
        symbols: ["SUI"],
        tradingMode: TradingMode.SPOT,
        exchangeType: "binance",
        decisionEngineVersion: "decision.v20",
      },
      runtime: runtimeDefaults.runtime.create(),
    },
    currentTime: 5_000,
    markPriceMap:
      typeof options.markPrice === "number"
        ? { SUI: { lastUpdated: 5_000, price: options.markPrice } }
        : {},
    mode: "sandbox",
    openPositions: [],
    vPointsMap: {},
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
      getRoundTripFeeRate: () => 0,
    },
    market: { getKlines: async () => [] },
    onAction: async () => null,
    onExit: async () => undefined,
    onNotif: () => true,
  };

  return { adapter, helper, state };
}

function makeDecision(
  step: { level: number; marginUsdt: number; status: "RESERVED" | "UNRESERVED" },
): RuntimeAveragingDecision {
  const position: Position = {
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
    fees: { entryUsdt: 0 },
    strategy: {
      entry: { engine: "decision.v20" },
      averaging: {
        entryLevel: -1,
        lastHandledLevel: -1,
        reserveBaseMarginUsdt: step.marginUsdt,
        reservedRemainingMarginUsdt: step.marginUsdt,
        steps: [
          {
            level: step.level,
            marginUsdt: step.marginUsdt,
            allocationPct: 1,
            status: step.status,
          },
        ],
      },
    },
    pnl: { history: [] },
  };
  const recommendation: AveragingRecommendation = {
    id: "B_avg",
    t: 5_000,
    l: "B",
    pct: 6,
    p: 95,
    vb: 1,
    vq: 1,
    lvl: -2,
    investAmount: step.marginUsdt,
    message: `Averaging LONG for SUI at level ${step.level}`,
    symbol: "SUI",
    maxLeverage: 1,
  };
  return {
    accountSlug: "a1",
    message: recommendation.message,
    position,
    recommendation,
    symbol: "SUI",
    type: "averaging",
  };
}

describe("averaging executeWithReason", () => {
  it("reports the spendable-balance refusal when the step margin exceeds available balance", () => {
    // The reported AAVE case: an approved averaging decision whose step
    // margin the account balance cannot fund.
    const context = makeContext({ available: 10, markPrice: 95 });
    const result = tradingAveraging.executeWithReason(
      context,
      makeDecision({ level: -2, marginUsdt: 50, status: "RESERVED" }),
    );

    expect(result.position).toBeNull();
    expect(result.blockReason).toContain("Insufficient spendable balance");
    expect(result.blockReason).toContain("$50.00");
    expect(result.blockReason).toContain("$10.00");
  });

  it("stamps the refusal onto the position's averaging step", () => {
    const context = makeContext({ available: 10, markPrice: 95 });
    const decision = makeDecision({
      level: -2,
      marginUsdt: 50,
      status: "RESERVED",
    });
    const result = tradingAveraging.executeWithReason(context, decision);

    const step = decision.position.strategy.averaging.steps[0];
    expect(step.attemptMessage).toBe(result.blockReason);
    expect(step.attemptMessage).toContain("Insufficient spendable balance");
    expect(step.attemptedAt).toBe(5_000);
  });

  it("reports the cost-vs-balance refusal when margin fits but margin + fee does not", () => {
    const context = makeContext({ available: 50, feeRate: 0.1, markPrice: 95 });
    const result = tradingAveraging.executeWithReason(
      context,
      makeDecision({ level: -2, marginUsdt: 50, status: "RESERVED" }),
    );

    expect(result.position).toBeNull();
    expect(result.blockReason).toContain("exceeds");
    expect(result.blockReason).toContain("$50.00");
  });

  it("reports a missing mark price", () => {
    const context = makeContext({ available: 500 });
    const result = tradingAveraging.executeWithReason(
      context,
      makeDecision({ level: -2, marginUsdt: 50, status: "RESERVED" }),
    );

    expect(result.position).toBeNull();
    expect(result.blockReason).toContain("No valid mark price for SUI");
  });

  it("keeps execute() returning just the position for legacy callers", () => {
    const context = makeContext({ available: 10, markPrice: 95 });
    expect(
      tradingAveraging.execute(
        context,
        makeDecision({ level: -2, marginUsdt: 50, status: "RESERVED" }),
      ),
    ).toBeNull();
  });
});
