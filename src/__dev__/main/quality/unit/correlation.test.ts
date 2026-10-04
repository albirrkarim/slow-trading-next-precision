import { describe, expect, it } from "vitest";

import { stepCorrelation } from "@/lib/system/utils/ui/correlation";

describe("stepCorrelation", () => {
  // BOTH: none — dev-page display math, not trading behavior

  it("returns +1 for identical step series", () => {
    const a = [
      { t: 0, v: 0 },
      { t: 10, v: 1 },
    ];
    expect(stepCorrelation(a, a, 20).r).toBeCloseTo(1, 6);
  });

  it("returns -1 for mirrored step series", () => {
    const a = [
      { t: 0, v: 0 },
      { t: 10, v: 1 },
    ];
    const b = [
      { t: 0, v: 1 },
      { t: 10, v: 0 },
    ];
    expect(stepCorrelation(a, b, 20).r).toBeCloseTo(-1, 6);
  });

  it("weights aligned intervals by duration, not change count", () => {
    // b diverges for a single tick inside a long shared plateau — the
    // brief disagreement must barely dent the score.
    const a = [
      { t: 0, v: 0 },
      { t: 10, v: 1 },
    ];
    const b = [
      { t: 0, v: 0 },
      { t: 1, v: 1 },
      { t: 2, v: 0 },
      { t: 10, v: 1 },
    ];
    const { r } = stepCorrelation(a, b, 20);
    expect(r).toBeGreaterThan(0.8);
  });

  it("returns undefined r when one side is flat", () => {
    const a = [
      { t: 0, v: 0 },
      { t: 10, v: 1 },
    ];
    const flat = [
      { t: 0, v: 0.5 },
      { t: 10, v: 0.5 },
    ];
    const result = stepCorrelation(a, flat, 20);
    expect(result.r).toBeUndefined();
    expect(result.samples).toBeGreaterThan(0);
  });

  it("returns undefined r when only one carried pair exists", () => {
    const a = [{ t: 0, v: 0 }];
    const b = [{ t: 5, v: 1 }];
    const result = stepCorrelation(a, b, 20);
    expect(result.samples).toBe(1);
    expect(result.r).toBeUndefined();
  });

  it("reports zero samples for empty or non-overlapping input", () => {
    expect(stepCorrelation([], [{ t: 0, v: 1 }], 20).samples).toBe(0);
    expect(stepCorrelation([], [], 20)).toEqual({ samples: 0 });
  });

  it("aligns series that start at different times", () => {
    // a carries its value into b's window — overlap starts at b[0].t.
    const a = [
      { t: 0, v: 0 },
      { t: 10, v: 1 },
    ];
    const b = [
      { t: 5, v: 0 },
      { t: 10, v: 1 },
    ];
    const { r, samples } = stepCorrelation(a, b, 20);
    expect(samples).toBe(2);
    expect(r).toBeCloseTo(1, 6);
  });
});
