import { describe, expect, it } from "vitest";
import { runtimeDefaults } from "@/lib/system/runtime";
import { TradingMode } from "@/lib/exchange/types";

import type {
  RuntimeContext,
  RuntimeEngineAdapter,
  RuntimeEngineState,
} from "@/lib/precision/types";
import type { RuntimeHelper } from "@/lib/precision/helper/types";
import type { Position } from "@/lib/system/trading";
import type { VolatilityPoint } from "@/lib/system/types";
import reserve from "@/lib/system/trading/reserve";
import tradingAveraging from "@/lib/system/trading/averaging";

function makeContext(vPointsMap: Record<string, VolatilityPoint[]>) {
  const state: RuntimeEngineState = {
    balance: {
      a1: {
        available: 1_000,
        locked: 0,
        reserved: 0,
        safeHaven: 0,
        spendable: 1_000,
        startingBalance: 1_000,
        total: 1_000,
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
          trading: runtimeDefaults.trading.create(),
          sandbox: { initialBalanceUSDT: 1_000 },
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
    markPriceMap: {},
    mode: "sandbox",
    openPositions: [],
    vPointsMap,
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
    exchange: { getFeeRate: () => 0, getRoundTripFeeRate: () => 0 },
    market: { getKlines: async () => [] },
    onAction: async () => null,
    onExit: async () => undefined,
    onNotif: () => true,
  };
  const context: RuntimeContext = { adapter, helper, state };
  return context;
}

function makeShortPosition(entryLevel: number): Position {
  return {
    account: "a1",
    symbol: "SUI",
    executionMode: "sandbox",
    tradingMode: TradingMode.SPOT,
    direction: "SHORT",
    opened: {
      t: 0,
      vPoint: { id: "T_open", lvl: entryLevel },
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
        entryLevel,
        lastHandledLevel: entryLevel,
        reserveBaseMarginUsdt: 100,
        reservedRemainingMarginUsdt: 200,
        steps: [
          {
            level: entryLevel + 1,
            marginUsdt: 200,
            allocationPct: 2,
            status: "RESERVED",
          },
        ],
      },
    },
    pnl: { history: [] },
  };
}

function makePoint(
  id: string,
  side: "T" | "B",
  lvl: number,
  t: number,
): VolatilityPoint {
  return { id, t, l: side, p: 106, pct: 6, vb: 1, vq: 1, lvl };
}

describe("isActionableAveragingLevel", () => {
  it("admits the first ±1 adverse point for a level-0 entry", () => {
    expect(
      reserve.vpoints.isActionableAveragingLevel({ lvl: 1 }, 0),
    ).toBe(true);
    expect(
      reserve.vpoints.isActionableAveragingLevel({ lvl: -1 }, 0),
    ).toBe(true);
  });

  it("keeps the legacy ±2 floor for nonzero and unknown entry levels", () => {
    expect(
      reserve.vpoints.isActionableAveragingLevel({ lvl: 1 }, 1),
    ).toBe(false);
    expect(
      reserve.vpoints.isActionableAveragingLevel({ lvl: 2 }, 1),
    ).toBe(true);
    expect(reserve.vpoints.isActionableAveragingLevel({ lvl: 1 })).toBe(
      false,
    );
  });

  it("rejects adverse levels at or below the entry depth", () => {
    expect(
      reserve.vpoints.isActionableAveragingLevel({ lvl: 0 }, 0),
    ).toBe(false);
    expect(
      reserve.vpoints.isActionableAveragingLevel({ lvl: 2 }, 2),
    ).toBe(false);
    expect(
      reserve.vpoints.isActionableAveragingLevel({ lvl: -1 }, -3),
    ).toBe(false);
  });
});

describe("findDecision level gate", () => {
  it("recommends averaging on a ±1 adverse point for a level-0 SHORT", async () => {
    const context = makeContext({
      SUI: [makePoint("T_open", "T", 0, 0), makePoint("T_avg", "T", 1, 5_000)],
    });
    const decision = await tradingAveraging.findDecision(
      context,
      makeShortPosition(0),
    );

    expect(decision).not.toBeNull();
    expect(decision?.recommendation.lvl).toBe(1);
  });

  it("does not treat the entry point itself as an averaging trigger", async () => {
    const context = makeContext({
      SUI: [makePoint("T_open", "T", 0, 0)],
    });
    const decision = await tradingAveraging.findDecision(
      context,
      makeShortPosition(0),
    );

    expect(decision).toBeNull();
  });
});
