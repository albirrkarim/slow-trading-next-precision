/**
 * EMA math — TradingView `ta.ema` semantics, folded one closed candle at a
 * time so the runtime feed and the chart share it. Pure; no I/O.
 */

import type { FoldCandle } from "../types";
import type { CoinEma, EmaAccumulator, EmaFeatureConfig, EmaSource } from "./types";

type Params = Pick<EmaFeatureConfig, "length" | "source">;

/** Fresh state. */
function create(): EmaAccumulator {
  return { e: 0, n: 0, pe: 0, t: 0 };
}

/** Candle price for `source`: close, (high+low)/2, or (high+low+close)/3. */
function sourcePrice(candle: FoldCandle, source: EmaSource): number {
  switch (source) {
    case "hl2":
      return (candle.high + candle.low) / 2;
    case "hlc3":
      return (candle.high + candle.low + candle.close) / 3;
    default:
      return candle.close;
  }
}

/**
 * Folds one closed candle: `ema = α·src + (1 − α)·ema[1]` with
 * `α = 2 / (length + 1)`; the first candle seeds the EMA with its source
 * price (Pine's `na(sum[1]) ? src`).
 */
function fold(acc: EmaAccumulator, candle: FoldCandle, { length, source }: Params): void {
  const price = sourcePrice(candle, source);
  if (!Number.isFinite(price)) return;
  const alpha = 2 / (length + 1);
  acc.pe = acc.e;
  acc.e = acc.n === 0 ? price : alpha * price + (1 - alpha) * acc.e;
  acc.n += 1;
  acc.t = candle.t;
}

/** True once `length` candles folded — before that the seed dominates. */
function ready(acc: EmaAccumulator, { length }: Pick<Params, "length">): boolean {
  return acc.n >= length && acc.e > 0;
}

/**
 * Coin-facing reading: EMA (5 significant digits), mark distance pct
 * (0.1 steps), and last-candle slope pct (0.01 steps). Undefined during
 * warm-up.
 */
function derive(
  acc: EmaAccumulator | undefined,
  params: Pick<Params, "length">,
  markPrice?: number,
): CoinEma | undefined {
  if (!acc || !ready(acc, params)) return undefined;
  const reading: CoinEma = { v: Number(acc.e.toPrecision(5)) };
  if (typeof markPrice === "number" && Number.isFinite(markPrice)) {
    reading.dPct = Number((((markPrice - acc.e) / acc.e) * 100).toFixed(1));
  }
  if (acc.n > 1 && acc.pe > 0) {
    reading.sPct = Number((((acc.e - acc.pe) / acc.pe) * 100).toFixed(2));
  }
  return reading;
}

const emaMath = {
  accumulator: { create, fold },
  derive,
  ready,
  sourcePrice,
} as const;

export default emaMath;
