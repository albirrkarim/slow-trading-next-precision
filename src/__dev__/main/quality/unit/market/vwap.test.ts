import { describe, expect, it } from "vitest";

import vwap from "@/lib/features/vwap";
import type { Kline } from "@/lib/system/types/market";

const MONTH = Date.UTC(2026, 0, 1);
const NEXT_MONTH = Date.UTC(2026, 1, 1);
const CANDLE_MS = 5 * 60_000;

/** Binance wire layout — only the fields VWAP reads. */
function kline(
  openTime: number,
  high: number,
  low: number,
  close: number,
  volume: number,
): Kline {
  return [
    openTime,
    String(close),
    String(high),
    String(low),
    String(close),
    String(volume),
    openTime + CANDLE_MS - 1,
  ] as unknown as Kline;
}

describe("vwap.monthStartMs", () => {
  it("floors to the UTC month boundary", () => {
    expect(vwap.monthStartMs(Date.UTC(2026, 4, 17, 23, 59))).toBe(
      Date.UTC(2026, 4, 1),
    );
    expect(vwap.monthStartMs(MONTH)).toBe(MONTH);
  });
});

describe("vwap.accumulator.foldKline", () => {
  it("weights the typical price (hlc3) by base volume", () => {
    const acc = vwap.accumulator.create(MONTH);
    // hlc3 = 10, vol 2  →  pv 20
    vwap.accumulator.foldKline(acc, kline(MONTH, 12, 8, 10, 2));
    // hlc3 = 20, vol 3  →  pv 60 → total 80, v 5 → vwap 16
    vwap.accumulator.foldKline(
      acc,
      kline(MONTH + CANDLE_MS, 24, 16, 20, 3),
    );

    expect(acc.pv).toBeCloseTo(80);
    expect(acc.v).toBe(5);
    expect(acc.n).toBe(2);
    expect(acc.t).toBe(MONTH + CANDLE_MS);
    const derived = vwap.derive(acc);
    expect(derived?.price).toBeCloseTo(16);
  });

  it("computes σ as the population stdev of hlc3", () => {
    const acc = vwap.accumulator.create(MONTH);
    // hlc3 values 10, 20 → mean 15, population σ = 5
    vwap.accumulator.foldKline(acc, kline(MONTH, 10, 10, 10, 1));
    vwap.accumulator.foldKline(
      acc,
      kline(MONTH + CANDLE_MS, 20, 20, 20, 1),
    );
    const derived = vwap.derive(acc);
    expect(derived?.stdev).toBeCloseTo(5);
  });

  it("a zero-volume candle moves σ but not the weighted mean", () => {
    const acc = vwap.accumulator.create(MONTH);
    vwap.accumulator.foldKline(acc, kline(MONTH, 10, 10, 10, 1));
    vwap.accumulator.foldKline(
      acc,
      kline(MONTH + CANDLE_MS, 30, 30, 30, 0),
    );
    const derived = vwap.derive(acc);
    // vwap stays 10 (the volume-less candle carries no weight) while σ
    // reads both prices: mean 20, σ = 10.
    expect(derived?.price).toBeCloseTo(10);
    expect(derived?.stdev).toBeCloseTo(10);
  });
});

describe("vwap.derive", () => {
  it("reports distancePct and stretchPct against the mark price", () => {
    const acc = vwap.accumulator.create(MONTH);
    vwap.accumulator.foldKline(acc, kline(MONTH, 100, 90, 90, 10));
    vwap.accumulator.foldKline(
      acc,
      kline(MONTH + CANDLE_MS, 120, 100, 110, 10),
    );
    // hlc3s: 93.33…, 110 → vwap ≈ 101.67 (quantized 101.7), σ ≈ 8.333
    const derived = vwap.derive(acc, 110);
    expect(derived?.price).toBeCloseTo(101.7, 1);
    expect(derived?.distancePct).toBeCloseTo(8.2, 1);
    // stretchPct = 2σ / vwap — the envelope width the gate preconditions on
    expect(derived?.stretchPct).toBeCloseTo(16.4, 1);
    expect(derived?.anchorT).toBe(MONTH);
  });

  it("exposes no opinion without folded volume or an accumulator", () => {
    expect(vwap.derive(undefined)).toBeUndefined();
    const acc = vwap.accumulator.create(MONTH);
    expect(vwap.derive(acc)).toEqual({ anchorT: MONTH });
  });

  it("omits distancePct when no mark price exists yet", () => {
    const acc = vwap.accumulator.create(MONTH);
    vwap.accumulator.foldKline(acc, kline(MONTH, 10, 10, 10, 1));
    const derived = vwap.derive(acc);
    expect(derived?.price).toBeCloseTo(10);
    expect(derived?.distancePct).toBeUndefined();
  });

  it("stamps dSigma for the signal vPoint and omits it without one", () => {
    const acc = vwap.accumulator.create(MONTH);
    vwap.accumulator.foldKline(acc, kline(MONTH, 100, 90, 90, 10));
    vwap.accumulator.foldKline(
      acc,
      kline(MONTH + CANDLE_MS, 120, 100, 110, 10),
    );
    // vwap ≈ 101.7, σ ≈ 8.333 → |110 − 101.7| / 8.333 ≈ 1.00σ.
    const withSignal = vwap.derive(acc, undefined, 110);
    expect(withSignal?.dSigma).toBeCloseTo(1.0, 1);
    expect(vwap.derive(acc)?.dSigma).toBeUndefined();
  });
});

describe("month boundary", () => {
  it("a new month anchor restarts the sums from zero", () => {
    // Mirrors the feed's rollover: acc.aT !== anchor → fresh accumulator.
    const jan = vwap.accumulator.create(MONTH);
    vwap.accumulator.foldKline(
      jan,
      kline(NEXT_MONTH - CANDLE_MS, 50, 50, 50, 5),
    );
    const febAnchor = vwap.monthStartMs(NEXT_MONTH);
    expect(jan.aT).not.toBe(febAnchor);
    const feb = vwap.accumulator.create(febAnchor);
    vwap.accumulator.foldKline(feb, kline(NEXT_MONTH, 10, 10, 10, 2));
    const derived = vwap.derive(feb);
    expect(derived?.price).toBeCloseTo(10);
    expect(feb.n).toBe(1);
  });
});
