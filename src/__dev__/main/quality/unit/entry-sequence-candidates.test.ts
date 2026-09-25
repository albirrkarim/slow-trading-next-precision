import entrySequenceCandidates from "@/components/LiveDashboard/Feature/entry-sequence-candidates";
import { runtimeEntrySequences } from "@/lib/system/trading";
import type { VolatilityPoint } from "@/lib/system/types";
import { describe, expect, it } from "vitest";

function point(lvl: number, t: number): VolatilityPoint {
  return {
    id: `point-${t}`,
    l: lvl < 0 ? "B" : "T",
    lvl,
    p: 1,
    pct: 1,
    t,
    vb: 1,
    vq: 1,
  } as VolatilityPoint;
}

describe("dashboard entry-sequence candidates", () => {
  it("uses the configured inclusive entry-level bounds", () => {
    const volatilityMap = {
      BTC: [point(4, 1)],
      sol: [point(1, 2), point(2, 3), point(-2, 4), point(3, 5)],
    };

    expect(
      entrySequenceCandidates
        .build({ minEntryAbsLevel: 2, volatilityMap })
        .map((candidate) => [candidate.symbol, candidate.lvl]),
    ).toEqual([
      ["SOL", 2],
      ["SOL", -2],
      ["SOL", 3],
    ]);

    expect(
      entrySequenceCandidates
        .build({ minEntryAbsLevel: 3, volatilityMap })
        .map((candidate) => candidate.lvl),
    ).toEqual([3]);

    expect(
      entrySequenceCandidates
        .build({ minEntryAbsLevel: 2, maxEntryAbsLevel: 2, volatilityMap })
        .map((candidate) => candidate.lvl),
    ).toEqual([2, -2]);
    expect(
      entrySequenceCandidates
        .build({ maxEntryAbsLevel: 0, volatilityMap: { sol: [point(0, 1), point(1, 2)] } })
        .map((candidate) => candidate.lvl),
    ).toEqual([0]);

    const zeroMap = { sol: [point(0, 1), point(1, 2)] };
    expect(runtimeEntrySequences.count({
      entrySignals: entrySequenceCandidates.build({
        maxEntryAbsLevel: 0,
        volatilityMap: zeroMap,
      }),
      volatilityMap: zeroMap,
    })[0].total).toBe(1);
  });

  it("treats undefined as disabled and zero as an active bound", () => {
    expect(entrySequenceCandidates.threshold.resolve()).toBeUndefined();
    expect(entrySequenceCandidates.threshold.resolveMax()).toBeUndefined();
    expect(entrySequenceCandidates.threshold.resolve(0)).toBe(0);
    expect(entrySequenceCandidates.threshold.resolveMax(0)).toBe(0);
    expect(entrySequenceCandidates.threshold.resolve(3.9)).toBe(3);
  });
});
