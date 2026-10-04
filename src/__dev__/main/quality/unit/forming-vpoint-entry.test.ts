import { describe, expect, it } from "vitest";

import { TradingMode } from "@/lib/exchange/types";
import type {
  RuntimeContext,
  RuntimeEntryDecision,
} from "@/lib/precision/types";
import { runtimeDefaults } from "@/lib/system/runtime";
import runtimeAccountConfig from "@/lib/system/runtime/account-config";
import runtimeAccounts from "@/lib/system/runtime/accounts";
import entry from "@/lib/system/trading/entry";
import entryAction from "@/lib/system/trading/entry-action";
import type {
  EntryRecommendation,
  PositionDirection,
} from "@/lib/system/trading/types";
import type { VolatilityPoint } from "@/lib/system/types";

const NOW = Date.UTC(2026, 8, 3, 10, 5);

function vpoint(overrides: Partial<VolatilityPoint> = {}): VolatilityPoint {
  return {
    id: `p_${overrides.lvl ?? -3}`,
    l: "B",
    lvl: -3,
    p: 100,
    pct: 5,
    t: NOW - 60_000,
    vb: 0,
    vq: 0,
    ...overrides,
  } as VolatilityPoint;
}

function tradingConfig(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    minEntryAbsLevel: 2,
    ...overrides,
  };
}

function entryContext(overrides: {
  markPriceMap?: Record<string, { lastUpdated: number; price: number }>;
  openPositions?: unknown[];
  runtime?: Record<string, unknown>;
  symbols?: string[];
  trading?: Record<string, unknown>;
  tradingMode?: string;
  vPointsMap?: Record<string, VolatilityPoint[]>;
}): RuntimeContext {
  const trading = tradingConfig(overrides.trading);
  return {
    adapter: {
      exchange: {
        getFeeRate: () => 0.001,
      },
    },
    helper: {
      getAccountBalance: () => ({
        available: 1_000,
        reserved: 0,
        safeHaven: 0,
        spendable: 1_000,
      }),
      getAccountConfig: () => trading,
    },
    state: {
      balance: {
        "acc-1": {
          available: 1_000,
          reserved: 0,
          safeHaven: 0,
          spendable: 1_000,
        },
      },
      config: {
        accounts: [
          {
            enabled: true,
            slug: "acc-1",
            trading,
          },
        ],
        management: {
          exchangeType: "binance",
          symbols: overrides.symbols ?? ["SUI"],
          tradingMode: overrides.tradingMode ?? "futures",
        },
        runtime: {
          autoRemoveSymbolAbsLevel: 0,
          autoRemoveSymbolMinPrice: 0,
          ...overrides.runtime,
        },
      },
      currentTime: NOW,
      markPriceMap: overrides.markPriceMap ?? {
        SUI: { lastUpdated: NOW, price: 100 },
      },
      mode: "sandbox",
      openPositions: overrides.openPositions ?? [],
      vPointsMap: overrides.vPointsMap ?? {},
    },
  } as unknown as RuntimeContext;
}

function formingDecision(overrides: {
  direction?: PositionDirection;
  signal?: Partial<EntryRecommendation>;
} = {}): RuntimeEntryDecision {
  return {
    accountSlug: "acc-1",
    direction: overrides.direction ?? "SHORT",
    entrySignal: {
      amountProbab: 0.5,
      forming: true,
      id: "p_-3",
      investAmount: 100,
      l: "B",
      lvl: -3,
      maxLeverage: 5,
      p: 100,
      ...overrides.signal,
    } as EntryRecommendation,
    message: "forming-vpoint SHORT",
    symbol: "SUI",
    type: "entry",
    vPointUsage: ["acc-1"],
  } as RuntimeEntryDecision;
}

describe("entry.forming.direction", () => {
  // BOTH:FORMING_VPOINT_ENTRY
  it("resolves SHORT when the down excursion qualifies", () => {
    expect(
      entry.forming.direction({ maxDownPct: 3, maxUpPct: 0 }, 3, 1),
    ).toBe("SHORT");
  });

  it("resolves LONG when the up excursion qualifies", () => {
    expect(
      entry.forming.direction({ maxDownPct: 0.5, maxUpPct: 3.5 }, 3, 1),
    ).toBe("LONG");
  });

  it("rejects when the adverse excursion reaches the limit (strict <)", () => {
    expect(
      entry.forming.direction({ maxDownPct: 3, maxUpPct: 1 }, 3, 1),
    ).toBeNull();
  });

  it("rejects when the favorable excursion stays below F", () => {
    expect(
      entry.forming.direction({ maxDownPct: 2.9, maxUpPct: 0 }, 3, 1),
    ).toBeNull();
  });

  it("rejects a point with no excursions", () => {
    expect(entry.forming.direction({}, 3, 1)).toBeNull();
  });

  it("honors the inclusive max-favorable cap", () => {
    // ↓5 at [3, 5] qualifies — the cap is inclusive.
    expect(
      entry.forming.direction({ maxDownPct: 5, maxUpPct: 0 }, 3, 2, 5),
    ).toBe("SHORT");
    // ↓5.01 exceeds the cap — excursions only grow, so it never fires.
    expect(
      entry.forming.direction({ maxDownPct: 5.01, maxUpPct: 0 }, 3, 2, 5),
    ).toBeNull();
    // ↑4 at [3, 5] qualifies LONG.
    expect(
      entry.forming.direction({ maxDownPct: 0, maxUpPct: 4 }, 3, 2, 5),
    ).toBe("LONG");
    // Without the cap argument behavior is unchanged (uncapped).
    expect(
      entry.forming.direction({ maxDownPct: 9, maxUpPct: 0 }, 3, 2),
    ).toBe("SHORT");
  });
});

describe("entry.forming.settings", () => {
  it("normalizes invalid percents to the defaults", () => {
    expect(
      entry.forming.settings({
        formingVPointEntryAdversePct: -1,
        formingVPointEntryEnabled: true,
        formingVPointEntryFavorablePct: 0,
      }),
    ).toEqual({
      adversePct: 2,
      enabled: true,
      favorablePct: 3,
      maxFavorablePct: Number.POSITIVE_INFINITY,
    });
    expect(entry.forming.settings({})).toEqual({
      adversePct: 2,
      enabled: false,
      favorablePct: 3,
      maxFavorablePct: Number.POSITIVE_INFINITY,
    });
  });

  it("treats missing or non-positive max favorable as uncapped", () => {
    for (const formingVPointEntryMaxFavorablePct of [
      undefined,
      0,
      -1,
      Number.NaN,
    ]) {
      expect(
        entry.forming.settings({ formingVPointEntryMaxFavorablePct })
          .maxFavorablePct,
      ).toBe(Number.POSITIVE_INFINITY);
    }
    expect(
      entry.forming.settings({ formingVPointEntryMaxFavorablePct: 6 })
        .maxFavorablePct,
    ).toBe(6);
  });
});

describe("entry.findDecisions forming-vPoint", () => {
  const formingTrading = {
    formingVPointEntryAdversePct: 1,
    formingVPointEntryEnabled: true,
    formingVPointEntryFavorablePct: 3,
  };

  it("emits a SHORT forming decision on a B point with ↓3/↑0", async () => {
    const context = entryContext({
      trading: formingTrading,
      vPointsMap: {
        SUI: [vpoint({ maxDownPct: 3, maxUpPct: 0 })],
      },
    });

    const decisions = await entry.findDecisions(context);

    expect(decisions).toHaveLength(1);
    expect(decisions[0].direction).toBe("SHORT");
    expect(decisions[0].entrySignal.forming).toBe(true);
    expect(decisions[0].vPointUsage).toEqual(["acc-1"]);
  });

  it("emits no decision when excursions do not qualify — the normal LONG is replaced", async () => {
    const context = entryContext({
      trading: formingTrading,
      vPointsMap: {
        SUI: [vpoint({ maxDownPct: 1, maxUpPct: 0 })],
      },
    });

    expect(await entry.findDecisions(context)).toEqual([]);
  });

  it("emits no decision when the favorable excursion is already past the cap", async () => {
    const context = entryContext({
      trading: {
        ...formingTrading,
        formingVPointEntryMaxFavorablePct: 5,
      },
      vPointsMap: {
        SUI: [vpoint({ maxDownPct: 6, maxUpPct: 0 })],
      },
    });

    expect(await entry.findDecisions(context)).toEqual([]);
  });

  it("keeps the normal LONG decision when the account is disabled", async () => {
    const context = entryContext({
      trading: { formingVPointEntryEnabled: false },
      vPointsMap: {
        SUI: [vpoint({ maxDownPct: 3, maxUpPct: 0 })],
      },
    });

    const decisions = await entry.findDecisions(context);

    expect(decisions).toHaveLength(1);
    expect(decisions[0].direction).toBe("LONG");
    expect(decisions[0].entrySignal.forming).toBeUndefined();
  });

  it("skips the drift guard for forming entries — a normal SHORT would be blocked", async () => {
    // Mark already 3% below the B point price: profitable drift for SHORT
    // beyond the 1% cap (volatility threshold 5).
    const markPriceMap = {
      SUI: { lastUpdated: NOW, price: 97 },
    };
    const forming = await entry.findDecisions(
      entryContext({
        markPriceMap,
        trading: formingTrading,
        vPointsMap: {
          SUI: [vpoint({ maxDownPct: 3, maxUpPct: 0 })],
        },
      }),
    );
    expect(forming).toHaveLength(1);
    expect(forming[0].direction).toBe("SHORT");

    const normal = await entry.findDecisions(
      entryContext({
        markPriceMap,
        vPointsMap: {
          SUI: [vpoint({ l: "T", lvl: 3 })],
        },
      }),
    );
    expect(normal).toEqual([]);
  });

  it("suppresses forming SHORT in spot mode but allows forming LONG", async () => {
    const shortContext = entryContext({
      trading: formingTrading,
      tradingMode: TradingMode.SPOT,
      vPointsMap: {
        SUI: [vpoint({ maxDownPct: 3, maxUpPct: 0 })],
      },
    });
    expect(await entry.findDecisions(shortContext)).toEqual([]);

    const longContext = entryContext({
      trading: formingTrading,
      tradingMode: TradingMode.SPOT,
      vPointsMap: {
        SUI: [vpoint({ l: "T", lvl: 3, maxDownPct: 0, maxUpPct: 3 })],
      },
    });
    const longDecisions = await entry.findDecisions(longContext);
    expect(longDecisions).toHaveLength(1);
    expect(longDecisions[0].direction).toBe("LONG");
    expect(longDecisions[0].entrySignal.forming).toBe(true);
  });

  it("skips a latest point already used by the account", async () => {
    const context = entryContext({
      trading: formingTrading,
      vPointsMap: {
        SUI: [
          vpoint({
            maxDownPct: 3,
            maxUpPct: 0,
            usedBy: ["acc-1"],
          }),
        ],
      },
    });

    expect(await entry.findDecisions(context)).toEqual([]);
  });
});

describe("forming-vPoint account config", () => {
  // BOTH:FORMING_VPOINT_ENTRY — the three Trading-tab keys must survive
  // the flat effective split/merge and persisted-record migration.
  it("round-trips all three keys through the effective config", () => {
    for (const key of [
      "formingVPointEntryAdversePct",
      "formingVPointEntryEnabled",
      "formingVPointEntryFavorablePct",
      "formingVPointEntryMaxFavorablePct",
    ]) {
      expect(runtimeAccountConfig.trading.keys.dynamic).toContain(key);
    }

    const flat = runtimeAccountConfig.trading.toEffective(
      runtimeDefaults.management.create(),
      {
        trading: {
          formingVPointEntryAdversePct: 1.5,
          formingVPointEntryEnabled: true,
          formingVPointEntryFavorablePct: 2.5,
          formingVPointEntryMaxFavorablePct: 4,
          notes: "",
          takeProfitPercent: 5,
        },
      },
    );
    expect(flat.formingVPointEntryEnabled).toBe(true);
    const split = runtimeAccountConfig.trading.fromEffective(flat);
    expect(split.formingVPointEntryEnabled).toBe(true);
    expect(split.formingVPointEntryFavorablePct).toBe(2.5);
    expect(split.formingVPointEntryMaxFavorablePct).toBe(4);
    expect(split.formingVPointEntryAdversePct).toBe(1.5);

    expect(
      runtimeAccounts.trading.migrate({
        formingVPointEntryEnabled: true,
        takeProfitPercent: 5,
      }).formingVPointEntryEnabled,
    ).toBe(true);
  });
});

describe("entryAction forming-vPoint plan", () => {
  // BOTH:FORMING_VPOINT_ENTRY — a forming entry on a watch-enabled account
  // must take the watch-off path: no reserve budget, no averaging steps.
  const context = entryContext({
    trading: {
      enableWatchLogic: true,
      watchMaxNextAveragingLevels: 2,
      watchReserveLevels: 2,
      watchReservePctAlloc: 0.5,
    },
  });

  it("plans with watch disabled and zero reserve budget", () => {
    const decision = formingDecision();
    const attempt = entryAction.planAttempt(context, decision);

    expect(attempt.plan).not.toBeNull();
    expect(attempt.plan?.watch.enabled).toBe(false);
    expect(attempt.plan?.fundingPlan.reserveBudgetUsdt).toBe(0);
  });

  it("builds a position labeled FORMING_VPOINT with an empty averaging state", () => {
    const decision = formingDecision();
    const result = entryAction.executeWithReason(context, decision);

    expect(result.position).not.toBeNull();
    expect(result.position?.strategy.entry.label).toBe("FORMING_VPOINT");
    expect(result.position?.strategy.averaging.steps).toEqual([]);
    expect(result.position?.direction).toBe("SHORT");
  });

  it("keeps reserve and averaging for a normal decision on the same account", () => {
    const decision = formingDecision({
      direction: "LONG",
      signal: { forming: undefined },
    });
    const attempt = entryAction.planAttempt(context, decision);

    expect(attempt.plan).not.toBeNull();
    expect(attempt.plan?.watch.enabled).toBe(true);
    expect(attempt.plan?.fundingPlan.reserveBudgetUsdt).toBeGreaterThan(0);
  });
});
