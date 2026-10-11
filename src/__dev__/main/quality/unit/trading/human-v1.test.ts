import { describe, expect, it } from "vitest";

import type { RuntimeFeatures } from "@/lib/features/types";
import type { RuntimeContext, RuntimeEngineState, RuntimeEntryDecision } from "@/lib/precision/types";
import humanV1 from "@/lib/strategies/human_v1";
import { HUMAN_V1_MIN_EMA_DISTANCE_PCT } from "@/lib/strategies/human_v1/entry";
import type { Position } from "@/lib/system/trading";

import { createTestPosition } from "../../fixtures/position";

const NOW = Date.UTC(2026, 5, 15, 12, 0);
/** Entry distance the strategy requires; the fixture EMA is 100, so pct = price − 100. */
const MIN = HUMAN_V1_MIN_EMA_DISTANCE_PCT;
const above = (pct: number) => 100 + pct;
const below = (pct: number) => 100 - pct;

/** Features with one EMA (`ema50` = 100) and the given Supertrend directions for SUI. */
function features(directions: Record<string, 1 | -1>, emaValue = 100): RuntimeFeatures {
  return {
    coins: {
      SUI: {
        ind: {
          ema: { ema50: { v: emaValue } },
          supertrend: Object.fromEntries(
            Object.entries(directions).map(([id, d]) => [id, { d, l: 95 }]),
          ),
        },
        priceNormalized: { history: [] },
      },
    },
    defs: {
      ema50: { id: "ema50", interval: "1h", length: 50, source: "close", type: "ema" },
      st1: { atrLength: 10, factor: 3, id: "st1", interval: "15m", type: "supertrend" },
      st2: { atrLength: 10, factor: 3, id: "st2", interval: "1h", type: "supertrend" },
    },
    shared: {},
  };
}

function makeContext(
  mark: number,
  feature: RuntimeFeatures,
  overrides: Partial<RuntimeEngineState> = {},
): RuntimeContext {
  const state = {
    balance: { acc: { available: 1_000, locked: 0, reserved: 0, safeHaven: 0, spendable: 1_000, total: 1_000 } },
    config: {
      accounts: [
        {
          enabled: true,
          slug: "acc",
          // Wide thresholds so only the strategy's own exit can fire.
          trading: { stopLossPercent: 90, stopLossUSDT: 0, takeProfitPercent: 90 },
        },
      ],
      management: { exchangeType: "binance", symbols: ["SUI"], tradingMode: "futures" },
      runtime: { autoEntryEnabled: true, autoExitEnabled: true, runnerEnabled: true },
    },
    currentTime: NOW,
    features: feature,
    markPriceMap: { SUI: { lastUpdated: NOW, price: mark } },
    mode: "backtest",
    openPositions: [],
    vPointsMap: {},
    ...overrides,
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

/** Runs the entry producer at a new mark, reusing the same runtime state. */
async function entryAt(context: RuntimeContext, mark: number, feature?: RuntimeFeatures) {
  context.state.markPriceMap.SUI = { lastUpdated: NOW, price: mark };
  if (feature) context.state.features = feature;
  return (await humanV1.decisions!.entry!.find(context)) as RuntimeEntryDecision[];
}

// BOTH:HUMAN_V1_ENTRY
describe("human_v1 entry", () => {
  it("seeds on the first pass, then enters LONG on a fresh cross with every Supertrend up", async () => {
    const context = makeContext(99, features({ st1: 1, st2: 1 }));
    expect(await entryAt(context, 99)).toEqual([]); // first observation: below
    expect(await entryAt(context, 99.5)).toEqual([]); // still below
    const [decision] = await entryAt(context, above(MIN)); // crossed above, at the minimum distance
    expect(decision).toMatchObject({
      accountSlug: "acc",
      direction: "LONG",
      entrySignal: { amountProbab: 0.5, l: "B", lvl: 1, p: above(MIN) },
      strategy: { emaId: "ema50", v: "human_v1" },
      symbol: "SUI",
      type: "entry",
    });
    expect(decision.entrySignal.id).toMatch(/^H_SUI_/);
    expect(decision.message).toContain("st1, st2 all up");
    // Staying above is not a new cross.
    expect(await entryAt(context, above(MIN + 1))).toEqual([]);
  });

  it("arms on the cross and enters only once price is the minimum distance beyond the EMA", async () => {
    const context = makeContext(99, features({ st1: 1, st2: 1 }));
    await entryAt(context, 99);
    expect(await entryAt(context, above(MIN * 0.4))).toEqual([]); // crossed, too close
    expect(await entryAt(context, above(MIN * 0.9))).toEqual([]); // still under the minimum
    const [decision] = await entryAt(context, above(MIN * 1.5)); // armed cross confirms
    expect(decision).toMatchObject({ direction: "LONG", entrySignal: { p: above(MIN * 1.5) } });
    expect(decision.message).toContain(`(+${(MIN * 1.5).toFixed(2)}%)`);
    // The arm is consumed: no second entry while price stays above.
    expect(await entryAt(context, above(MIN * 2))).toEqual([]);
  });

  it("drops the arm when price crosses back before reaching the minimum distance", async () => {
    const context = makeContext(99, features({ st1: 1, st2: 1 }));
    await entryAt(context, 99);
    await entryAt(context, above(MIN * 0.5)); // armed LONG
    await entryAt(context, below(0.2)); // crossed back below — arms SHORT instead
    expect(await entryAt(context, above(MIN * 1.5))).toMatchObject([{ direction: "LONG" }]); // fresh cross up again
  });

  it("waits while armed until every Supertrend agrees", async () => {
    const context = makeContext(99, features({ st1: 1, st2: -1 }));
    await entryAt(context, 99);
    expect(await entryAt(context, above(MIN * 1.5))).toEqual([]); // armed, Supertrends split
    expect(await entryAt(context, above(MIN * 1.6), features({ st1: 1, st2: 1 }))).toMatchObject([{ direction: "LONG" }]);
  });

  it("never enters mid-trend on boot", async () => {
    const context = makeContext(110, features({ st1: 1, st2: 1 }));
    expect(await entryAt(context, 110)).toEqual([]);
    expect(await entryAt(context, 111)).toEqual([]);
  });

  it("enters SHORT on a cross below with every Supertrend down", async () => {
    const context = makeContext(above(MIN), features({ st1: -1, st2: -1 }));
    await entryAt(context, above(MIN));
    const [decision] = await entryAt(context, below(MIN));
    expect(decision).toMatchObject({ direction: "SHORT", entrySignal: { l: "T", lvl: -1 } });
  });

  it("skips a cross the Supertrends do not all confirm", async () => {
    const context = makeContext(99, features({ st1: 1, st2: -1 }));
    await entryAt(context, 99);
    expect(await entryAt(context, above(MIN * 2))).toEqual([]);
  });

  it("skips coins without an EMA or Supertrend reading", async () => {
    const noSupertrend = makeContext(99, features({}));
    await entryAt(noSupertrend, 99);
    expect(await entryAt(noSupertrend, above(MIN * 2))).toEqual([]);
  });

  it("keeps one position per coin and no shorts in spot", async () => {
    const open = createTestPosition({ account: "acc", symbol: "SUI" });
    const busy = makeContext(99, features({ st1: 1, st2: 1 }), { openPositions: [open] as never });
    await entryAt(busy, 99);
    expect(await entryAt(busy, above(MIN * 2))).toEqual([]);

    const spot = makeContext(101, features({ st1: -1, st2: -1 }));
    spot.state.config.management.tradingMode = "spot" as never;
    await entryAt(spot, 101);
    expect(await entryAt(spot, below(MIN * 2))).toEqual([]);
  });
});

// BOTH:HUMAN_V1_EMA_EXIT
describe("human_v1 exit", () => {
  const humanPosition = (direction: Position["direction"]): Position => {
    const position = createTestPosition({
      account: "acc",
      direction,
      entryPrice: 101,
      entryTime: NOW - 60 * 60_000,
      symbol: "SUI",
    });
    position.strategy.logic = { emaId: "ema50", v: "human_v1" };
    return position;
  };

  it("closes a LONG once the mark crosses back below its EMA, as STRATEGY_EXIT", async () => {
    const position = humanPosition("LONG");
    expect(await humanV1.decisions!.exit!.find(makeContext(100.5, features({ st1: 1 })), position)).toBeNull();

    const decision = await humanV1.decisions!.exit!.find(makeContext(99.5, features({ st1: 1 })), position);
    expect(decision?.position).toBe(position);
    expect(decision?.tradeDecision.position?.closed).toMatchObject({ reason: "STRATEGY_EXIT" });
    expect(decision?.message).toContain("HUMAN_V1:EMA_CROSS");
    expect(decision?.tradeDecision.position?.control?.forceExit).toBeUndefined();
  });

  it("closes a SHORT once the mark crosses back above its EMA", async () => {
    const decision = await humanV1.decisions!.exit!.find(
      makeContext(100.5, features({ st1: -1 })),
      humanPosition("SHORT"),
    );
    expect(decision?.tradeDecision.position?.closed?.reason).toBe("STRATEGY_EXIT");
  });

  it("leaves positions it did not open to the shared rules", async () => {
    const foreign = createTestPosition({ account: "acc", direction: "LONG", entryPrice: 101, symbol: "SUI" });
    expect(await humanV1.decisions!.exit!.find(makeContext(99.5, features({ st1: 1 })), foreign)).toBeNull();
  });
});

// BOTH:HUMAN_V1_NO_AVERAGING
describe("human_v1 averaging", () => {
  it("never produces an averaging candidate", async () => {
    const position = createTestPosition({ account: "acc", symbol: "SUI" });
    expect(await humanV1.decisions!.averaging!.find(makeContext(50, features({ st1: 1 })), position)).toBeNull();
  });
});

describe("human_v1 diagnostics", () => {
  it("explains what the coin is waiting for", () => {
    const explain = (context: RuntimeContext) =>
      humanV1.diagnostics!.explain!({ accountSlug: "acc", context, symbol: "SUI" });
    expect(explain(makeContext(101, features({ st1: 1, st2: -1 })))).toMatchObject({
      reason: expect.stringContaining("Supertrends disagree"),
      status: "blocked",
    });
    expect(explain(makeContext(99, features({ st1: 1, st2: 1 })))).toMatchObject({
      reason: expect.stringContaining("other side of ema50"),
    });
    expect(explain(makeContext(101, features({ st1: 1, st2: 1 })))).toMatchObject({
      reason: expect.stringContaining("waiting for a fresh cross"),
      status: "blocked",
    });
    const armed = makeContext(above(MIN * 0.5), features({ st1: 1, st2: 1 }));
    armed.state.strategy = { armed: { SUI: 1 }, side: { SUI: 1 }, v: "human_v1" };
    expect(explain(armed)).toMatchObject({
      reason: expect.stringContaining(`${(MIN * 0.5).toFixed(2)}% beyond, needs ${MIN}%`),
      status: "blocked",
    });
    armed.state.markPriceMap.SUI.price = above(MIN * 1.2);
    expect(explain(armed)).toMatchObject({ status: "ready" });
  });
});
