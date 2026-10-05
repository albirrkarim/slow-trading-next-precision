import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/precision/defaultDecision", () => ({
  default: {
    entry: { find: vi.fn(async () => []) },
  },
}));

import features, { FEATURES_VPOINT_WINDOW_MS } from "@/lib/features";
import { computePriceNormalized } from "@/lib/features/price-normalized";
import type {
  RuntimeContext,
  RuntimeEntryDecision,
} from "@/lib/precision/types";
import strategy, {
  FEATURE_GATE_BOUNDS,
} from "@/lib/strategies/default_with_features_gate";
import defaultDecision from "@/lib/precision/defaultDecision";
import vpoints from "@/lib/system/utils/vpoints";
import type { Position } from "@/lib/system/trading";
import type { VolatilityPoint } from "@/lib/system/types";

const NOW = Date.UTC(2026, 9, 1, 12, 0);
const DAY_MS = 24 * 60 * 60 * 1000;

function point(t: number, p: number): VolatilityPoint {
  return {
    id: `B_${t}_${p}`,
    l: "B",
    lvl: -1,
    p,
    pct: 3,
    t,
    vb: 0,
    vq: 0,
  } as VolatilityPoint;
}

function contextWith(params: {
  features?: RuntimeContext["state"]["features"];
  symbols?: string[];
  vPointsMap?: Record<string, VolatilityPoint[]>;
}): RuntimeContext {
  return {
    state: {
      config: {
        management: {
          description: "",
          exchangeType: "binance",
          name: "test",
          symbols: params.symbols ?? ["SUI"],
          tradingMode: "futures",
        },
      },
      currentTime: NOW,
      features: params.features,
      vPointsMap: params.vPointsMap ?? {},
    },
  } as unknown as RuntimeContext;
}

function candidate(symbol: string): RuntimeEntryDecision {
  return {
    accountSlug: "main",
    direction: "LONG",
    entrySignal: { id: `sig_${symbol}` } as RuntimeEntryDecision["entrySignal"],
    message: `${symbol} signal`,
    symbol,
    type: "entry",
  };
}

describe("computePriceNormalized", () => {
  it("normalizes the latest pivot inside the earlier-pivot envelope", () => {
    const points = [
      point(NOW - 40 * DAY_MS, 80),
      point(NOW - 30 * DAY_MS, 120),
      point(NOW - 10 * DAY_MS, 100),
      point(NOW - DAY_MS, 110),
    ];
    // latest 110 sits at (110-80)/(120-80) = 0.75 of the prior envelope
    expect(computePriceNormalized({ now: NOW, points })).toBeCloseTo(0.75);
  });

  it("excludes the latest pivot from its own range so breakouts exceed 1", () => {
    const points = [
      point(NOW - 40 * DAY_MS, 80),
      point(NOW - 30 * DAY_MS, 120),
      point(NOW - 20 * DAY_MS, 90),
      point(NOW - DAY_MS, 150),
    ];
    // envelope is [80,120] — the newest pivot at 150 reads > 1
    const value = computePriceNormalized({ now: NOW, points });
    expect(value).toBeGreaterThan(1);
  });

  it("drops pivots older than the window", () => {
    const points = [
      point(NOW - FEATURES_VPOINT_WINDOW_MS - DAY_MS, 1),
      point(NOW - 30 * DAY_MS, 120),
      point(NOW - 20 * DAY_MS, 110),
      point(NOW - DAY_MS, 110),
    ];
    // windowed envelope is [110,120]; without the stale point at 1 the
    // latest pivot reads 0, not ~0.9.
    expect(computePriceNormalized({ now: NOW, points })).toBeCloseTo(0);
  });

  it("returns 0.5 for a flat range and undefined on thin history", () => {
    const flat = [
      point(NOW - 30 * DAY_MS, 100),
      point(NOW - 20 * DAY_MS, 100),
      point(NOW - DAY_MS, 100),
    ];
    expect(computePriceNormalized({ now: NOW, points: flat })).toBe(0.5);

    expect(
      computePriceNormalized({
        now: NOW,
        points: [point(NOW - DAY_MS, 100)],
      }),
    ).toBeUndefined();
    expect(
      computePriceNormalized({ now: NOW, points: undefined }),
    ).toBeUndefined();
  });
});

describe("features.update", () => {
  it("writes a coin entry for every symbol tracked in vPointsMap", () => {
    // vPointsMap always carries BTC market context plus configured coins —
    // features follow the map keys, not the traded-symbol config.
    const context = contextWith({
      symbols: ["SUI"],
      vPointsMap: {
        BTC: [
          point(NOW - 30 * DAY_MS, 80),
          point(NOW - 20 * DAY_MS, 120),
          point(NOW - DAY_MS, 100),
        ],
        SUI: [
          point(NOW - 30 * DAY_MS, 8),
          point(NOW - 20 * DAY_MS, 12),
          point(NOW - DAY_MS, 10),
        ],
      },
    });
    features.update(context);
    expect(Object.keys(context.state.features!.coins).sort()).toEqual([
      "BTC",
      "SUI",
    ]);
    expect(
      context.state.features!.coins.SUI.priceNormalized,
    ).toBeCloseTo(0.5);
    expect(
      context.state.features!.coins.BTC.priceNormalized,
    ).toBeCloseTo(0.5);
  });

  it("appends priceNormalized changes to a rolling 10-day history", () => {
    const context = contextWith({
      vPointsMap: {
        SUI: [
          point(NOW - 30 * DAY_MS, 8),
          point(NOW - 20 * DAY_MS, 12),
          point(NOW - DAY_MS, 10),
        ],
      },
    });

    // First update seeds the trail by replaying the pivot timeline — the
    // only in-window pivot is the latest one, recorded at its own time.
    features.update(context);
    const first = context.state.features!.coins.SUI.priceNormalizedHistory;
    expect(first).toEqual([{ p: 0.5, t: NOW - DAY_MS }]);

    // Same pivots → same value → no append, same array reference stays.
    features.update(context);
    expect(context.state.features!.coins.SUI.priceNormalizedHistory).toBe(
      first,
    );

    // A new pivot changes the value → one new history point is appended.
    const later = NOW + DAY_MS;
    context.state.currentTime = later;
    context.state.vPointsMap.SUI.push(point(later - DAY_MS, 9));
    features.update(context);
    const history =
      context.state.features!.coins.SUI.priceNormalizedHistory;
    expect(history).toHaveLength(2);
    expect(history[1].t).toBe(later);
    expect(history[1].p).toBeCloseTo(0.25); // envelope [8,12], latest 9
  });

  it("reconstructs the trail from the pivot timeline at first update", () => {
    const context = contextWith({
      vPointsMap: {
        SUI: [
          point(NOW - 30 * DAY_MS, 8),
          point(NOW - 20 * DAY_MS, 12),
          point(NOW - 8 * DAY_MS, 10),
          point(NOW - 4 * DAY_MS, 14),
          point(NOW - DAY_MS, 9),
        ],
      },
    });
    features.update(context);

    // The two pre-window pivots are envelope anchors only; the three
    // in-window pivots replay as-of their own times against the pivots
    // that preceded them: 10→0.5, 14→1.5, then 9 lands in an envelope
    // that now includes 14 → (9-8)/(14-8) ≈ 0.167.
    const history =
      context.state.features!.coins.SUI.priceNormalizedHistory;
    expect(history).toHaveLength(3);
    expect(history[0]).toEqual({ p: 0.5, t: NOW - 8 * DAY_MS });
    expect(history[1]).toEqual({ p: 1.5, t: NOW - 4 * DAY_MS });
    expect(history[2].t).toBe(NOW - DAY_MS);
    expect(history[2].p).toBeCloseTo(1 / 6);
    // Current value equals the last replayed point — no extra tick point.
    expect(context.state.features!.coins.SUI.priceNormalized).toBeCloseTo(
      1 / 6,
    );
  });

  it("resumes a persisted trail instead of reseeding it", () => {
    const existing = [{ p: 0.4, t: NOW - 5 * DAY_MS }];
    const context = contextWith({
      features: {
        coins: {
          SUI: {
            priceNormalized: 0.4,
            priceNormalizedHistory: existing,
          },
        },
        shared: {},
      },
      vPointsMap: {
        SUI: [
          point(NOW - 30 * DAY_MS, 8),
          point(NOW - 20 * DAY_MS, 12),
          point(NOW - DAY_MS, 9.6), // (9.6-8)/(12-8) = 0.4 — unchanged
        ],
      },
    });
    features.update(context);
    expect(context.state.features!.coins.SUI.priceNormalizedHistory).toBe(
      existing,
    );
  });

  it("trims history older than 20 days but keeps the last survivor", () => {
    const context = contextWith({
      features: {
        coins: {
          SUI: {
            priceNormalized: 0.5,
            priceNormalizedHistory: [
              { p: 0.9, t: NOW - 40 * DAY_MS },
              { p: 0.5, t: NOW - 25 * DAY_MS },
            ],
          },
        },
        shared: {},
      },
      vPointsMap: {
        SUI: [
          point(NOW - 30 * DAY_MS, 8),
          point(NOW - 20 * DAY_MS, 12),
          point(NOW - DAY_MS, 10),
        ],
      },
    });

    // Value unchanged (0.5) → no append; both stale points collapse to the
    // last one, which survives so "unchanged since t" stays readable.
    features.update(context);
    expect(
      context.state.features!.coins.SUI.priceNormalizedHistory,
    ).toEqual([{ p: 0.5, t: NOW - 25 * DAY_MS }]);
  });
});

describe("features.changedCoins", () => {
  it("lists only symbols whose feature values moved", () => {
    const previous = {
      SUI: { priceNormalized: 0.5, priceNormalizedHistory: [] },
    };
    const next = {
      LINK: { priceNormalized: 0.1, priceNormalizedHistory: [] },
      SUI: { priceNormalized: 0.8, priceNormalizedHistory: [] },
    };
    expect(features.changedCoins(previous, next).sort()).toEqual([
      "LINK",
      "SUI",
    ]);
    expect(features.changedCoins(previous, previous)).toEqual([]);
  });
});

describe("vpoints.retainRecent sinceMs", () => {
  it("keeps points inside the window even beyond the recent count", () => {
    const points = Array.from({ length: 20 }, (_, index) =>
      point(NOW - (20 - index) * DAY_MS, 100 + index),
    );
    const retained = vpoints.retainRecent({
      points,
      positions: [] as Position[],
      recent: 3,
      sinceMs: NOW - 10 * DAY_MS,
      symbol: "SUI",
    });
    // the 10 in-window points survive despite recent=3
    expect(retained.map((p) => p.t)).toEqual(
      points.slice(10).map((p) => p.t),
    );
  });
});

describe("default_with_features_gate", () => {
  const find = vi.mocked(defaultDecision.entry.find);

  // Bounds are strategy-owned constants that get tuned — fixtures derive
  // from them so the suite covers the gate logic, not literal numbers.
  const coinMin = FEATURE_GATE_BOUNDS.minPriceNormalized;
  const coinMax = FEATURE_GATE_BOUNDS.maxPriceNormalized;
  const btcMin = FEATURE_GATE_BOUNDS.btcMinPriceNormalized;
  const btcMax = FEATURE_GATE_BOUNDS.btcMaxPriceNormalized;
  const coinIn = (coinMin + coinMax) / 2;
  const btcIn = (btcMin + btcMax) / 2;
  // Half the judge window — always inside it regardless of tuning.
  const recently = (FEATURE_GATE_BOUNDS.historyWindowDays * DAY_MS) / 2;

  it("filters candidates outside the coin priceNormalized zone", async () => {
    find.mockResolvedValue([
      candidate("SUI"),
      candidate("LINK"),
      candidate("AAVE"),
    ]);
    const context = contextWith({
      features: {
        coins: {
          AAVE: {
            priceNormalized: coinMin - 0.1,
            priceNormalizedHistory: [],
          },
          LINK: {
            priceNormalized: coinMax + 0.1,
            priceNormalizedHistory: [],
          },
          SUI: { priceNormalized: coinMin, priceNormalizedHistory: [] },
        },
        shared: {},
      },
      symbols: ["SUI", "LINK", "AAVE"],
    });

    // LINK above the ceiling and AAVE below the floor drop; SUI sits on the
    // inclusive floor boundary and stays.
    const kept = await strategy.decisions!.entry!.find(context);
    expect(kept.map((entry) => entry.symbol)).toEqual(["SUI"]);
  });

  it("blocks every candidate when BTC sits outside its context bounds", async () => {
    find.mockResolvedValue([candidate("SUI"), candidate("LINK")]);
    const context = contextWith({
      features: {
        coins: {
          BTC: {
            priceNormalized: btcMax + 0.1,
            priceNormalizedHistory: [],
          },
          LINK: { priceNormalized: coinIn, priceNormalizedHistory: [] },
          SUI: { priceNormalized: coinIn, priceNormalizedHistory: [] },
        },
        shared: {},
      },
      symbols: ["SUI", "LINK"],
    });

    expect(await strategy.decisions!.entry!.find(context)).toEqual([]);

    // The BTC veto also explains skipped candidates via diagnostics.
    const explained = strategy.diagnostics!.explain!({
      accountSlug: "main",
      context,
      decision: candidate("SUI"),
      symbol: "SUI",
    });
    expect(explained?.code).toBe("FEATURE_GATE");
    expect(explained?.reason).toContain("BTC");
  });

  it("vetoes candidates when BTC breaks down below its floor", async () => {
    find.mockResolvedValue([candidate("SUI")]);
    const context = contextWith({
      features: {
        coins: {
          BTC: {
            priceNormalized: btcMin - 0.1,
            priceNormalizedHistory: [],
          },
          SUI: { priceNormalized: coinIn, priceNormalizedHistory: [] },
        },
        shared: {},
      },
    });
    expect(await strategy.decisions!.entry!.find(context)).toEqual([]);
  });

  it("leaves the coin zone alone while BTC stays inside its bounds", async () => {
    find.mockResolvedValue([candidate("SUI")]);
    const context = contextWith({
      features: {
        coins: {
          BTC: { priceNormalized: btcIn, priceNormalizedHistory: [] },
          SUI: { priceNormalized: coinMin, priceNormalizedHistory: [] },
        },
        shared: {},
      },
    });
    expect(await strategy.decisions!.entry!.find(context)).toHaveLength(1);
  });

  it("rejects a coin whose recent history touched outside the zone", async () => {
    const excursion = coinMax + 0.15;
    find.mockResolvedValue([candidate("SUI")]);
    const context = contextWith({
      features: {
        coins: {
          // Current value is inside the zone but the 10-day trail holds an
          // excursion above the ceiling — the history veto still blocks.
          SUI: {
            priceNormalized: coinIn,
            priceNormalizedHistory: [
              { p: excursion, t: NOW - recently },
              { p: coinIn, t: NOW - DAY_MS },
            ],
          },
        },
        shared: {},
      },
    });
    expect(await strategy.decisions!.entry!.find(context)).toEqual([]);

    const explained = strategy.diagnostics!.explain!({
      accountSlug: "main",
      context,
      decision: candidate("SUI"),
      symbol: "SUI",
    });
    expect(explained?.code).toBe("FEATURE_GATE");
    expect(explained?.reason).toContain(excursion.toFixed(3));
  });

  it("ignores excursions that aged out of the judge window", async () => {
    find.mockResolvedValue([candidate("SUI")]);
    const beyond = (FEATURE_GATE_BOUNDS.historyWindowDays + 1) * DAY_MS;
    const context = contextWith({
      features: {
        coins: {
          BTC: { priceNormalized: btcIn, priceNormalizedHistory: [] },
          // The excursion predates the judge window — the record keeps it
          // for display but the gate no longer counts it.
          SUI: {
            priceNormalized: coinIn,
            priceNormalizedHistory: [
              { p: coinMax + 0.15, t: NOW - beyond },
              { p: coinIn, t: NOW - DAY_MS },
            ],
          },
        },
        shared: {},
      },
    });
    expect(await strategy.decisions!.entry!.find(context)).toHaveLength(1);
  });

  it("vetoes every candidate when BTC history broke its bounds", async () => {
    find.mockResolvedValue([candidate("SUI"), candidate("LINK")]);
    const context = contextWith({
      features: {
        coins: {
          BTC: {
            priceNormalized: btcIn,
            priceNormalizedHistory: [
              { p: btcMin - 0.1, t: NOW - recently },
              { p: btcIn, t: NOW - DAY_MS },
            ],
          },
          LINK: { priceNormalized: coinIn, priceNormalizedHistory: [] },
          SUI: { priceNormalized: coinIn, priceNormalizedHistory: [] },
        },
        shared: {},
      },
      symbols: ["SUI", "LINK"],
    });

    // BTC is inside its zone now but dipped below the floor two days ago —
    // the market-context veto blocks every candidate while that excursion
    // is still inside the 10-day trail.
    expect(await strategy.decisions!.entry!.find(context)).toEqual([]);
  });

  it("passes every candidate when features are absent", async () => {
    find.mockResolvedValue([candidate("SUI"), candidate("LINK")]);
    const context = contextWith({});
    const kept = await strategy.decisions!.entry!.find(context);
    expect(kept).toHaveLength(2);
  });

  it("explains a gated decision through diagnostics", () => {
    const context = contextWith({
      features: {
        coins: {
          SUI: {
            priceNormalized: coinMax + 0.15,
            priceNormalizedHistory: [],
          },
        },
        shared: {},
      },
    });
    const explained = strategy.diagnostics!.explain!({
      accountSlug: "main",
      context,
      decision: candidate("SUI"),
      symbol: "SUI",
    });
    expect(explained?.code).toBe("FEATURE_GATE");
    expect(explained?.status).toBe("blocked");
    expect(explained?.reason).toContain("priceNormalized");

    // no decision → fall back to the default explanation path
    expect(
      strategy.diagnostics!.explain!({
        accountSlug: "main",
        context,
        symbol: "SUI",
      }),
    ).toBeUndefined();
  });
});
