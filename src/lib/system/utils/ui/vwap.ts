/**
 * Anchored VWAP for the chart layer: buckets chart candles by anchor
 * (session/week/month/…) and runs the runtime's `features/vwap` fold per
 * bucket, so the chart and the gate share one formula. Pure — no exchange
 * or runtime I/O; the output drops straight into line series.
 */

import vwapFeature from "@/lib/features/vwap";
import type { VwapAccumulator } from "@/lib/features/types";

export type VwapAnchor =
  | "session"
  | "week"
  | "month"
  | "all"
  | "entry"
  | "vpoint";

export interface VwapCandle {
  /** Chart time in seconds. */
  time: number;
  high: number;
  low: number;
  close: number;
  /** Base volume. */
  volume: number;
}

export interface VwapPoint {
  time: number;
  value: number;
}

export interface VwapSeries {
  vwap: VwapPoint[];
  /** bands[i] pairs with the i-th requested multiplier. */
  upper: VwapPoint[][];
  lower: VwapPoint[][];
}

const DAY_MS = 24 * 60 * 60_000;
const WEEK_MS = 7 * DAY_MS;

/**
 * Bucket key per candle: candles sharing a key accumulate into the same
 * VWAP run. `-1` means "exclude the candle" (entry anchor not reached).
 * Session/week/month use UTC boundaries since crypto trades 24/7; "vpoint"
 * buckets by the pivot boundaries the caller supplies.
 */
function anchorKey(
  timeMs: number,
  anchor: VwapAnchor,
  opts: { anchorTimeMs?: number; boundariesMs?: number[] },
): number {
  switch (anchor) {
    case "all":
      return 0;
    case "entry":
      return opts.anchorTimeMs !== undefined && timeMs >= opts.anchorTimeMs
        ? 0
        : -1;
    case "vpoint": {
      // Bucket = count of pivots at/before the candle — each pivot opens a
      // new accumulation run, so the line tracks one volatility wave.
      const boundaries = opts.boundariesMs;
      if (!boundaries?.length) return 0;
      let lo = 0;
      let hi = boundaries.length;
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (boundaries[mid] <= timeMs) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    }
    case "session":
      return Math.floor(timeMs / DAY_MS);
    case "week":
      // Epoch fell on a Thursday — shift by 4d so buckets open Monday UTC.
      return Math.floor((timeMs - 4 * DAY_MS) / WEEK_MS);
    case "month":
      return vwapFeature.monthStartMs(timeMs);
    default:
      return -1;
  }
}

/**
 * Computes the anchored VWAP line and stdev bands over chart candles.
 * Each anchor bucket runs its own `features/vwap` accumulator — the exact
 * fold the runtime gate uses — so VWAP = Σ(hlc3 × volume) / Σvolume and
 * σ = population stdev of hlc3 since the bucket opened; each band =
 * vwap ± mult × σ. Candles with non-positive volume extend the line
 * unchanged (they move nothing).
 */
function compute(
  candles: VwapCandle[],
  {
    anchor,
    anchorTimeMs,
    boundariesMs,
    bands = [],
  }: {
    anchor: VwapAnchor;
    /** ms epoch; required for the "entry" anchor. */
    anchorTimeMs?: number;
    /** Sorted pivot times (ms); drives the "vpoint" anchor. */
    boundariesMs?: number[];
    bands?: number[];
  },
): VwapSeries {
  const vwap: VwapPoint[] = [];
  const upper = bands.map(() => [] as VwapPoint[]);
  const lower = bands.map(() => [] as VwapPoint[]);

  let currentKey: number | null = null;
  let acc: VwapAccumulator | undefined;
  const boundaries =
    boundariesMs && boundariesMs.length > 1
      ? [...boundariesMs].sort((a, b) => a - b)
      : boundariesMs;

  for (const candle of candles) {
    const t = candle.time * 1000;
    const key = anchorKey(t, anchor, { anchorTimeMs, boundariesMs: boundaries });
    if (key === -1) continue;

    if (key !== currentKey || !acc) {
      currentKey = key;
      acc = vwapFeature.accumulator.create(key);
    }
    vwapFeature.accumulator.fold(acc, { ...candle, t });

    const values = vwapFeature.raw(acc);
    if (!values) continue;

    vwap.push({ time: candle.time, value: values.price });
    bands.forEach((mult, i) => {
      upper[i].push({ time: candle.time, value: values.price + mult * values.stdev });
      lower[i].push({ time: candle.time, value: values.price - mult * values.stdev });
    });
  }

  return { vwap, upper, lower };
}

/**
 * Maps a series computed on another candle interval onto the chart's
 * candle times: each chart candle takes the latest source point whose
 * candle had closed by the chart candle's close — the value the runtime
 * could see then (it folds closed candles only).
 */
function resample(
  points: VwapPoint[],
  times: number[],
  chartIntervalSec: number,
  sourceIntervalSec: number,
): VwapPoint[] {
  const out: VwapPoint[] = [];
  let index = -1;
  for (const time of times) {
    const closeTime = time + chartIntervalSec;
    while (
      index + 1 < points.length &&
      points[index + 1].time + sourceIntervalSec <= closeTime
    ) {
      index += 1;
    }
    if (index >= 0) out.push({ time, value: points[index].value });
  }
  return out;
}

/** Resamples every line of a VWAP series onto chart candle times. */
function resampleSeries(
  series: VwapSeries,
  {
    times,
    chartIntervalSec,
    sourceIntervalSec,
  }: { times: number[]; chartIntervalSec: number; sourceIntervalSec: number },
): VwapSeries {
  const map = (points: VwapPoint[]) =>
    resample(points, times, chartIntervalSec, sourceIntervalSec);
  return {
    vwap: map(series.vwap),
    upper: series.upper.map(map),
    lower: series.lower.map(map),
  };
}

/**
 * Candle interval (seconds) inferred from chart candle spacing — the
 * smallest positive gap among the first candles, so an exchange gap can't
 * inflate it. 0 with fewer than two candles.
 */
function intervalSec(candles: Pick<VwapCandle, "time">[]): number {
  let min = Infinity;
  for (let i = 1; i < Math.min(candles.length, 20); i++) {
    const gap = candles[i].time - candles[i - 1].time;
    if (gap > 0 && gap < min) min = gap;
  }
  return Number.isFinite(min) ? min : 0;
}

const vwap = {
  compute,
  intervalSec,
  resample: resampleSeries,
};

export default vwap;
