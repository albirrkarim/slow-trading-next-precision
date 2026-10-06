import { describe, expect, it } from "vitest";

import vwap from "@/lib/system/utils/ui/vwap";
import type { VwapCandle } from "@/lib/system/utils/ui/vwap";

/** 1-minute candles; `time` is chart seconds. */
function candle(
  time: number,
  high: number,
  low: number,
  close: number,
  volume: number,
): VwapCandle {
  return { time, high, low, close, volume };
}

const DAY_S = 86_400;

describe("vwap.compute", () => {
  it("volume-weights hlc3 cumulatively under the all anchor", () => {
    const result = vwap.compute(
      [
        candle(60, 10, 8, 9, 10), // src 9, pv 90
        candle(120, 12, 10, 11, 20), // src 11, pv 220
      ],
      { anchor: "all" },
    );

    expect(result.vwap).toHaveLength(2);
    expect(result.vwap[0].value).toBeCloseTo(9);
    expect(result.vwap[1].value).toBeCloseTo(310 / 30);
  });

  it("resets accumulation at each UTC session boundary", () => {
    const day2 = DAY_S;
    const result = vwap.compute(
      [
        candle(60, 10, 8, 9, 10), // day 1: src 9
        candle(day2 + 60, 20, 18, 19, 5), // day 2: src 19
      ],
      { anchor: "session" },
    );

    expect(result.vwap[0].value).toBeCloseTo(9);
    // Day 2 starts a fresh run — not a blend with day 1.
    expect(result.vwap[1].value).toBeCloseTo(19);
  });

  it("anchors at the first candle on/after the entry time", () => {
    const result = vwap.compute(
      [
        candle(60, 10, 8, 9, 10),
        candle(120, 12, 10, 11, 20), // src 11 — entry anchor at its open
        candle(180, 14, 12, 13, 10), // src 13
      ],
      { anchor: "entry", anchorTimeMs: 120_000 },
    );

    expect(result.vwap).toHaveLength(2);
    expect(result.vwap[0].time).toBe(120);
    expect(result.vwap[0].value).toBeCloseTo(11);
    expect(result.vwap[1].value).toBeCloseTo((220 + 130) / 30);
  });

  it("restarts accumulation at each pivot boundary under the vpoint anchor", () => {
    const result = vwap.compute(
      [
        candle(60, 10, 8, 9, 10), // src 9 — before first pivot: own run
        candle(120, 12, 10, 11, 20), // src 11 — same run
        candle(180, 20, 18, 19, 5), // src 19 — pivot at 120s... 
      ],
      {
        anchor: "vpoint",
        boundariesMs: [180_000], // pivot lands on the third candle
      },
    );

    // Candles 1-2 share one run; candle 3 opens a fresh one.
    expect(result.vwap[1].value).toBeCloseTo(310 / 30);
    expect(result.vwap[2].value).toBeCloseTo(19);
  });

  it("behaves like the all anchor when no pivot boundaries exist", () => {
    const candles = [
      candle(60, 10, 8, 9, 10),
      candle(120, 12, 10, 11, 20),
    ];
    const result = vwap.compute(candles, { anchor: "vpoint" });

    expect(result.vwap[1].value).toBeCloseTo(310 / 30);
  });

  it("returns an empty series for the entry anchor without an anchor time", () => {
    const result = vwap.compute([candle(60, 10, 8, 9, 10)], {
      anchor: "entry",
    });
    expect(result.vwap).toHaveLength(0);
  });

  it("extends the line unchanged through zero-volume candles", () => {
    const result = vwap.compute(
      [
        candle(60, 10, 8, 9, 10), // src 9 → vwap 9
        candle(120, 30, 28, 29, 0), // no volume — stays 9
      ],
      { anchor: "all" },
    );

    expect(result.vwap).toHaveLength(2);
    expect(result.vwap[1].value).toBeCloseTo(9);
  });

  it("emits no points while the run has no volume at all", () => {
    const result = vwap.compute(
      [candle(60, 10, 8, 9, 0), candle(120, 12, 10, 11, 5)],
      { anchor: "all" },
    );

    expect(result.vwap).toHaveLength(1);
    expect(result.vwap[0].time).toBe(120);
    expect(result.vwap[0].value).toBeCloseTo(11);
  });

  it("places bands at ±mult × cumulative population stdev of hlc3", () => {
    const result = vwap.compute(
      [
        candle(60, 10, 8, 9, 10), // src 9
        candle(120, 12, 10, 11, 20), // src 11
      ],
      { anchor: "all", bands: [1] },
    );

    // Population σ of {9, 11} = 1; vwap = 310/30 ≈ 10.333.
    expect(result.upper[0][1].value).toBeCloseTo(310 / 30 + 1);
    expect(result.lower[0][1].value).toBeCloseTo(310 / 30 - 1);
    // Single-sample bucket: σ = 0 → bands sit on the vwap line.
    expect(result.upper[0][0].value).toBeCloseTo(9);
    expect(result.lower[0][0].value).toBeCloseTo(9);
  });
});
