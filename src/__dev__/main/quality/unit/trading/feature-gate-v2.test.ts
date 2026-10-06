import { describe, expect, it } from "vitest";

import type { RuntimeContext } from "@/lib/precision/types";
import featureGateV2, {
  FEATURE_GATE_VWAP_BOUNDS,
} from "@/lib/strategies/default_with_features_gate/feature_gate_v2";
import type { CoinFeatures } from "@/lib/features/types";
import type { VolatilityPoint } from "@/lib/system/types";

function contextWith(coin?: CoinFeatures): RuntimeContext {
  return {
    state: {
      features: {
        coins: coin ? { SUI: coin } : {},
        shared: {},
      },
    },
  } as unknown as RuntimeContext;
}

function signal(p: number): VolatilityPoint {
  return { p } as VolatilityPoint;
}

/** Coin with vwap 100, σ 10, stretch 20% — comfortably past the 5% floor. */
const READY: CoinFeatures = {
  priceNormalized: { history: [] },
  vwap: {
    anchorT: Date.UTC(2026, 0, 1),
    price: 100,
    stdev: 10,
    stretchPct: 20,
  },
};

describe("featureGateV2", () => {
  it("refuses when the coin has no VWAP feature", () => {
    expect(featureGateV2(contextWith(), "SUI", signal(110))).toContain(
      "no monthly VWAP feature",
    );
    expect(
      featureGateV2(
        contextWith({
          priceNormalized: { history: [] },
          vwap: { anchorT: 1 },
        }),
        "SUI",
        signal(110),
      ),
    ).toContain("no monthly VWAP feature");
  });

  it("refuses a monthly envelope narrower than the 5% floor", () => {
    const narrow = {
      ...READY,
      vwap: { ...READY.vwap, stretchPct: 4.9 },
    };
    expect(featureGateV2(contextWith(narrow), "SUI", signal(115))).toContain(
      "too narrow",
    );
    // The floor is checked before the zone — even a perfectly-placed
    // signal cannot rescue a wave with no room to mean-revert.
    expect(
      featureGateV2(contextWith(narrow), "SUI", signal(100)),
    ).toContain("too narrow");
    expect(FEATURE_GATE_VWAP_BOUNDS.minStretchPct).toBe(5);
  });

  it("passes when no signal is supplied — the gate only vetoes on evidence", () => {
    expect(featureGateV2(contextWith(READY), "SUI", undefined)).toBeUndefined();
  });

  it("admits signals between 1σ and 2σ on either side of the VWAP", () => {
    // vwap 100, σ 10 → zone = |p−100| ∈ [10, 20]
    for (const p of [80, 82, 110, 115, 118, 120]) {
      expect(
        featureGateV2(contextWith(READY), "SUI", signal(p)),
        `p=${p}`,
      ).toBeUndefined();
    }
  });

  it("includes the 1σ and 2σ boundaries", () => {
    expect(
      featureGateV2(contextWith(READY), "SUI", signal(110)),
    ).toBeUndefined();
    expect(
      featureGateV2(contextWith(READY), "SUI", signal(120)),
    ).toBeUndefined();
  });

  it("refuses signals inside 1σ — not stretched enough", () => {
    for (const p of [100, 105, 95]) {
      expect(
        featureGateV2(contextWith(READY), "SUI", signal(p)),
        `p=${p}`,
      ).toContain("inside the 1σ");
    }
  });

  it("refuses signals beyond 2σ — overstretched", () => {
    for (const p of [121, 130, 79]) {
      expect(
        featureGateV2(contextWith(READY), "SUI", signal(p)),
        `p=${p}`,
      ).toContain("beyond the 2σ");
    }
  });

  it("is distance-only — direction does not matter", () => {
    // A bottom priced above VWAP and a top priced below VWAP both still
    // pass on σ distance alone.
    expect(
      featureGateV2(contextWith(READY), "SUI", {
        l: "B",
        p: 115,
      } as VolatilityPoint),
    ).toBeUndefined();
    expect(
      featureGateV2(contextWith(READY), "SUI", {
        l: "T",
        p: 85,
      } as VolatilityPoint),
    ).toBeUndefined();
  });
});
