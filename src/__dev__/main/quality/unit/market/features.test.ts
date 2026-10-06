import { describe, expect, it } from "vitest";

import features, { FEATURES_VPOINT_WINDOW_MS } from "@/lib/features";
import { computePriceNormalized } from "@/lib/features/price-normalized";
import vwap from "@/lib/features/vwap";
import type { RuntimeContext } from "@/lib/precision/types";
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
      context.state.features!.coins.SUI.priceNormalized.current,
    ).toBeCloseTo(0.5);
    expect(
      context.state.features!.coins.BTC.priceNormalized.current,
    ).toBeCloseTo(0.5);
    // latestVpoint mirrors the newest pivot — the same in-place object.
    expect(context.state.features!.coins.SUI.latestVpoint).toBe(
      context.state.vPointsMap.SUI.at(-1),
    );
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
    const firstGroup = context.state.features!.coins.SUI.priceNormalized;
    expect(firstGroup.history).toEqual([{ p: 0.5, t: NOW - DAY_MS }]);

    // Same pivots → same value → no append: the group object itself is
    // reused so changedCoins identity-diffing stays sparse.
    features.update(context);
    expect(context.state.features!.coins.SUI.priceNormalized).toBe(
      firstGroup,
    );
    expect(
      context.state.features!.coins.SUI.priceNormalized.history,
    ).toBe(firstGroup.history);

    // A new pivot changes the value → one new history point is appended.
    const later = NOW + DAY_MS;
    context.state.currentTime = later;
    context.state.vPointsMap.SUI.push(point(later - DAY_MS, 9));
    features.update(context);
    const history =
      context.state.features!.coins.SUI.priceNormalized.history;
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
      context.state.features!.coins.SUI.priceNormalized.history;
    expect(history).toHaveLength(3);
    expect(history[0]).toEqual({ p: 0.5, t: NOW - 8 * DAY_MS });
    expect(history[1]).toEqual({ p: 1.5, t: NOW - 4 * DAY_MS });
    expect(history[2].t).toBe(NOW - DAY_MS);
    expect(history[2].p).toBeCloseTo(1 / 6);
    // Current value equals the last replayed point — no extra tick point.
    expect(
      context.state.features!.coins.SUI.priceNormalized.current,
    ).toBeCloseTo(1 / 6);
  });

  it("resumes a persisted trail instead of reseeding it", () => {
    const existing = [{ p: 0.4, t: NOW - 5 * DAY_MS }];
    const context = contextWith({
      features: {
        coins: {
          SUI: {
            priceNormalized: { current: 0.4, history: existing },
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
    expect(context.state.features!.coins.SUI.priceNormalized.history).toBe(
      existing,
    );
  });

  it("reseeds the trail when the persisted record predates the group", () => {
    // Legacy flat records carry the trail on `priceNormalizedHistory` —
    // invisible to the group read, so the replay reseeds it.
    const context = contextWith({
      features: {
        coins: {
          SUI: {
            priceNormalized: 0.4,
            priceNormalizedHistory: [
              { p: 0.4, t: NOW - 5 * DAY_MS },
            ],
          } as never,
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
    features.update(context);
    expect(
      context.state.features!.coins.SUI.priceNormalized.history,
    ).toEqual([{ p: 0.5, t: NOW - DAY_MS }]);
  });

  it("trims history older than 20 days but keeps the last survivor", () => {
    const context = contextWith({
      features: {
        coins: {
          SUI: {
            priceNormalized: {
              current: 0.5,
              history: [
                { p: 0.9, t: NOW - 40 * DAY_MS },
                { p: 0.5, t: NOW - 25 * DAY_MS },
              ],
            },
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
      context.state.features!.coins.SUI.priceNormalized.history,
    ).toEqual([{ p: 0.5, t: NOW - 25 * DAY_MS }]);
  });
});

describe("features.update vwap", () => {
  it("derives vwap fields into coins and carries the accumulator through", () => {
    // Monthly accumulator for SUI: two candles, hlc3 10 & 20 → vwap 16,
    // σ 5 — written by the market stage, derived here.
    const acc = vwap.accumulator.create(Date.UTC(2026, 9, 1));
    vwap.accumulator.foldKline(acc, [
      NOW - 10 * 60_000,
      "10",
      "10",
      "10",
      "10",
      "2",
      NOW - 5 * 60_000,
    ] as never);
    vwap.accumulator.foldKline(acc, [
      NOW - 5 * 60_000,
      "20",
      "20",
      "20",
      "20",
      "3",
      NOW,
    ] as never);

    const context = contextWith({
      features: { coins: {}, shared: {}, vwap: { SUI: acc } },
      vPointsMap: {
        SUI: [
          point(NOW - 30 * DAY_MS, 8),
          point(NOW - 20 * DAY_MS, 12),
          point(NOW - DAY_MS, 10),
        ],
      },
    });
    context.state.markPriceMap = {
      SUI: { lastUpdated: NOW, price: 19 },
    };

    features.update(context);

    const coin = context.state.features!.coins.SUI;
    expect(coin.vwap?.price).toBeCloseTo(16);
    expect(coin.vwap?.stdev).toBeCloseTo(5);
    expect(coin.vwap?.distancePct).toBeCloseTo(18.8, 1);
    expect(coin.vwap?.anchorT).toBe(Date.UTC(2026, 9, 1));
    // The accumulator is an input — it survives the coins rebuild untouched.
    expect(context.state.features!.vwap!.SUI).toBe(acc);
  });

  it("emits no vwap group for a coin without an accumulator", () => {
    const context = contextWith({
      vPointsMap: {
        SUI: [
          point(NOW - 30 * DAY_MS, 8),
          point(NOW - 20 * DAY_MS, 12),
          point(NOW - DAY_MS, 10),
        ],
      },
    });
    features.update(context);
    const coin = context.state.features!.coins.SUI;
    expect(coin.vwap).toBeUndefined();
  });
});

describe("features.changedCoins", () => {
  it("lists only symbols whose feature values moved", () => {
    const previous = {
      SUI: { priceNormalized: { current: 0.5, history: [] } },
    };
    const next = {
      LINK: { priceNormalized: { current: 0.1, history: [] } },
      SUI: { priceNormalized: { current: 0.8, history: [] } },
    };
    expect(features.changedCoins(previous, next).sort()).toEqual([
      "LINK",
      "SUI",
    ]);
    expect(features.changedCoins(previous, previous)).toEqual([]);
  });

  it("ignores per-pass vwap/latestVpoint keys but still flags real changes", () => {
    // update() reuses the group object when nothing moved — share the
    // references so the shallow diff mirrors real snapshots.
    const pnAda = { current: 0.4, history: [] };
    const pnLink = { current: 0.1, history: [] };
    const pnLinkNext = { current: 0.2, history: [] };
    const pnSui = { current: 0.5, history: [] };
    const pnDoge = { current: 0.6, history: [] };
    const pointA = point(NOW - DAY_MS, 1);
    const pointB = point(NOW - DAY_MS, 2);
    const previous = {
      ADA: {
        latestVpoint: pointA,
        priceNormalized: pnAda,
        vwap: { anchorT: NOW - DAY_MS, price: 10 },
      },
      DOGE: { latestVpoint: pointA, priceNormalized: pnDoge },
      LINK: { latestVpoint: pointA, priceNormalized: pnLink },
      SUI: {
        latestVpoint: pointA,
        priceNormalized: pnSui,
        vwap: {
          anchorT: NOW - DAY_MS,
          distancePct: 2,
          price: 10,
          stdev: 0.5,
          stretchPct: 1,
        },
      },
    };
    const next = {
      // ADA re-anchored inside the vwap group alone — the group is
      // excluded wholesale, so a month rollover no longer lists the coin.
      ADA: {
        latestVpoint: pointA,
        priceNormalized: pnAda,
        vwap: { anchorT: NOW, price: 10 },
      },
      // DOGE only swapped the latestVpoint object: excluded, not listed.
      DOGE: { latestVpoint: pointB, priceNormalized: pnDoge },
      // LINK's priceNormalized group is a new object (current moved):
      // listed even though vwap moved too.
      LINK: {
        latestVpoint: pointA,
        priceNormalized: pnLinkNext,
        vwap: { price: 30 },
      },
      // SUI moved only vwap fields: not listed.
      SUI: {
        latestVpoint: pointA,
        priceNormalized: pnSui,
        vwap: {
          anchorT: NOW - DAY_MS,
          distancePct: 2.3,
          price: 10.4,
          stdev: 0.6,
          stretchPct: 1.1,
        },
      },
    };
    expect(features.changedCoins(previous, next).sort()).toEqual(["LINK"]);
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
