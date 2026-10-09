import { describe, expect, it } from "vitest";

import movementCorrelation from "@/lib/features/price-norm-movement";
import type { FeatureHistoryPoint } from "@/lib/features/types";

const HOUR = 60 * 60 * 1000;

function trail(values: number[], offset = 0): FeatureHistoryPoint[] {
  return values.map((p, index) => ({ p, t: index * 6 * HOUR + offset }));
}

describe("priceNorm movement correlation preview", () => {
  it("scores matching and inverse movement at opposite ends of the 0–1 scale", () => {
    const btc = trail([0, 0.3, 0.1, 0.6, 0.2, 0.8]);
    expect(movementCorrelation.score(btc, trail([1, 1.6, 1.2, 2.2, 1.4, 2.6])))
      .toBeCloseTo(1);
    expect(movementCorrelation.score(btc, trail([1, 0.4, 0.8, -0.2, 0.6, -0.6])))
      .toBeCloseTo(0);
  });

  it("aligns sparse steps by time, tolerating small event offsets", () => {
    const btc = trail([0, 0.3, 0.1, 0.6, 0.2, 0.8]);
    const coin = trail([0, 0.3, 0.1, 0.6, 0.2, 0.8], HOUR);
    expect(movementCorrelation.score(btc, coin)).toBeGreaterThan(0.8);
  });

  it("withholds a score for flat or nonoverlapping trails", () => {
    const btc = trail([0, 0.3, 0.1, 0.6]);
    expect(movementCorrelation.score(btc, trail([1, 1, 1, 1]))).toBeUndefined();
    expect(movementCorrelation.score(btc, trail([0, 0.3, 0.1, 0.6], 10 * 24 * HOUR)))
      .toBeUndefined();
  });
});
