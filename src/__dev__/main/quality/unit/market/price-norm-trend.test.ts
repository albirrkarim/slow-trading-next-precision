import { describe, expect, it } from "vitest";

import { priceNormTrend } from "@/lib/features/price-norm-trend";

const trail = (values: number[], stepMs = 86_400_000) =>
  values.map((p, i) => ({ p, t: i * stepMs }));

describe("priceNormTrend", () => {
  it("scores near +1 for a clearly rising trail", () => {
    const score = priceNormTrend(
      trail([0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 0.9]),
    );
    expect(score).toBeGreaterThan(0.7);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("scores near -1 for a clearly falling trail", () => {
    const score = priceNormTrend(
      trail([0.95, 0.8, 0.7, 0.55, 0.4, 0.25, 0.1]),
    );
    expect(score).toBeLessThan(-0.7);
  });

  it("scores near 0 for a sideways trail", () => {
    expect(
      Math.abs(
        priceNormTrend(trail([0.5, 0.52, 0.48, 0.51, 0.49, 0.5, 0.51])),
      ),
    ).toBeLessThan(0.2);
  });

  it("scores near 0 for a zigzag that ends where it started", () => {
    expect(
      Math.abs(priceNormTrend(trail([0.3, 0.7, 0.3, 0.7, 0.3, 0.7, 0.3]))),
    ).toBeLessThan(0.3);
  });

  it("damps drift that is tiny relative to the observed span", () => {
    // Net move ~0.04 while the trail spans 0.5 — weak traverse.
    const score = priceNormTrend(
      trail([0.1, 0.6, 0.3, 0.55, 0.4, 0.5, 0.14]),
    );
    expect(Math.abs(score)).toBeLessThan(0.3);
  });

  it("scores a sparse monotone trail clearly — the slow-BTC case", () => {
    // Three deduped normalized steps, all rising: |net| = path → ±1.
    expect(priceNormTrend(trail([-0.257, 0.317, 0.566]))).toBeCloseTo(1);
    expect(priceNormTrend(trail([0.8, 0.4, 0.15]))).toBeCloseTo(-1);
  });

  it("damps a sparse trail that retraces", () => {
    // Up-down-up: net +0.3 over path 0.5+0.4+0.2 → +0.27.
    const score = priceNormTrend(trail([0.3, 0.8, 0.4, 0.6]));
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(0.5);
  });

  it("returns 0 for too-short or flat trails", () => {
    expect(priceNormTrend(trail([0.5, 0.9]))).toBe(0);
    expect(priceNormTrend(trail([0.5, 0.5, 0.5, 0.5, 0.5]))).toBe(0);
    expect(priceNormTrend([])).toBe(0);
  });

  it("tolerates unsorted and invalid points", () => {
    const messy = [
      { p: 0.8, t: 300 },
      { p: Number.NaN, t: 999 },
      { p: 0.2, t: 100 },
      { p: 0.35, t: 150 },
      { p: 0.5, t: 200 },
      { p: 0.65, t: 250 },
      { p: 0.95, t: 400 },
    ];
    expect(priceNormTrend(messy)).toBeGreaterThan(0.7);
  });
});
