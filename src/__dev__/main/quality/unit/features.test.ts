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
import strategy from "@/lib/strategies/default_with_features_gate";
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
  featureGate?: { maxPriceNormalized?: number; minPriceNormalized?: number };
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
          featureGate: params.featureGate,
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
});

describe("features.changedCoins", () => {
  it("lists only symbols whose feature values moved", () => {
    const previous = { SUI: { priceNormalized: 0.5 } };
    const next = {
      LINK: { priceNormalized: 0.1 },
      SUI: { priceNormalized: 0.8 },
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

  it("filters candidates outside the configured priceNormalized bounds", async () => {
    find.mockResolvedValue([candidate("SUI"), candidate("LINK")]);
    const context = contextWith({
      featureGate: { maxPriceNormalized: 0.8 },
      features: {
        coins: {
          LINK: { priceNormalized: 0.9 },
          SUI: { priceNormalized: 0.2 },
        },
        shared: {},
      },
      symbols: ["SUI", "LINK"],
    });

    const kept = await strategy.decisions!.entry!.find(context);
    expect(kept.map((entry) => entry.symbol)).toEqual(["SUI"]);
  });

  it("passes every candidate when no gate is configured", async () => {
    find.mockResolvedValue([candidate("SUI"), candidate("LINK")]);
    const context = contextWith({});
    const kept = await strategy.decisions!.entry!.find(context);
    expect(kept).toHaveLength(2);
  });

  it("explains a gated decision through diagnostics", () => {
    const context = contextWith({
      featureGate: { maxPriceNormalized: 0.8 },
      features: {
        coins: { SUI: { priceNormalized: 0.95 } },
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
