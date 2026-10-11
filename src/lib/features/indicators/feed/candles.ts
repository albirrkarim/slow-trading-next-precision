/**
 * Base-candle aggregation for indicator intervals. The live stream only
 * carries 1m/5m, so 15m…1d candles are built from base klines on
 * UTC-aligned boundaries. Pure; no I/O.
 */

import type { Kline } from "@/lib/system/types/market";

import type { FoldCandle } from "../types";

/** Kline tuple → fold candle (`t` = open time ms). */
function fromKline(kline: Kline): FoldCandle {
  return {
    t: Number(kline[0]),
    high: Number(kline[2]),
    low: Number(kline[3]),
    close: Number(kline[4]),
    volume: Number(kline[5]),
  };
}

/**
 * Aggregates base klines (sorted, `baseMs` wide) into closed `intervalMs`
 * candles opening at or after `fromMs`. A bucket is emitted once it closed
 * by `nowMs` and either holds its last base candle, or the close is
 * `2 × baseMs` in the past (a hole in the data — fold what exists rather
 * than stall forever). The first bucket still waiting on a late base
 * candle holds back every later bucket too, so the caller's cursor never
 * skips past it.
 */
function aggregate(
  klines: Kline[],
  {
    baseMs,
    intervalMs,
    fromMs,
    nowMs,
  }: { baseMs: number; intervalMs: number; fromMs: number; nowMs: number },
): FoldCandle[] {
  if (intervalMs === baseMs) {
    return klines
      .filter((kline) => kline[0] >= fromMs && kline[0] + baseMs <= nowMs)
      .map(fromKline);
  }

  const out: FoldCandle[] = [];
  let bucket: FoldCandle | undefined;
  let hasLast = false;
  let held = false;

  const flush = () => {
    if (!bucket) return;
    const closeMs = bucket.t + intervalMs;
    if (
      !held &&
      closeMs <= nowMs &&
      (hasLast || closeMs + 2 * baseMs <= nowMs)
    ) {
      out.push(bucket);
    } else {
      held = true;
    }
    bucket = undefined;
  };

  for (const kline of klines) {
    const openMs = Number(kline[0]);
    if (openMs < fromMs) continue;
    const bucketStart = Math.floor(openMs / intervalMs) * intervalMs;
    const candle = fromKline(kline);
    if (!bucket || bucket.t !== bucketStart) {
      flush();
      bucket = { ...candle, t: bucketStart };
      hasLast = false;
    } else {
      bucket.high = Math.max(bucket.high, candle.high);
      bucket.low = Math.min(bucket.low, candle.low);
      bucket.close = candle.close;
      bucket.volume += candle.volume;
    }
    if (openMs + baseMs === bucketStart + intervalMs) hasLast = true;
  }
  flush();
  return out;
}

const indicatorCandles = { aggregate, fromKline } as const;

export default indicatorCandles;
