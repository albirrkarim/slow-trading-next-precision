/**
 * Monthly-anchored VWAP feature math — pure functions, no I/O. The
 * feature feed (`features/vwap-feed`) folds closed klines into the
 * `state.features.vwap` accumulator; `features.update` derives the
 * per-coin `vwap` group consumed by gates and snapshots.
 */
import type { Kline } from "@/lib/system/types/market";
import type { CoinVwap, VwapAccumulator } from "./types";

/**
 * Candle interval the runtime VWAP folds — pinned to 5m even on 1m speedup
 * passes so σ granularity stays consistent. The chart's "match gate" mode
 * reads the same constant.
 */
const INTERVAL = "5m" as const;
const INTERVAL_MS = 5 * 60_000;

/** UTC month-start (ms) containing `timeMs` — the VWAP anchor boundary. */
function monthStartMs(timeMs: number): number {
  const d = new Date(timeMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

/** Fresh zeroed accumulator anchored at `anchorMs`. */
function createAccumulator(anchorMs: number): VwapAccumulator {
  return { aT: anchorMs, n: 0, pv: 0, s: 0, s2: 0, t: 0, v: 0 };
}

/** One candle's VWAP inputs — `t` is the open time in ms. */
export interface VwapFoldCandle {
  t: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Folds one candle into the accumulator: `hlc3` feeds both the weighted
 * mean (`pv`/`v`, volume-gated — a candle nobody traded cannot move the
 * average) and the population σ sums (`s`/`s2`/`n`). Advances `acc.t` to
 * the candle's open time. The single VWAP fold shared by the runtime feed
 * and the chart overlay.
 */
function fold(acc: VwapAccumulator, candle: VwapFoldCandle): void {
  const { high, low, close, volume } = candle;
  if (
    !Number.isFinite(high) ||
    !Number.isFinite(low) ||
    !Number.isFinite(close)
  ) {
    return;
  }
  const src = (high + low + close) / 3;
  acc.n += 1;
  acc.s += src;
  acc.s2 += src * src;
  if (Number.isFinite(volume) && volume > 0) {
    acc.pv += src * volume;
    acc.v += volume;
  }
  acc.t = candle.t;
}

/** Folds one exchange kline tuple (`[openTime, open, high, low, close, volume, …]`). */
function foldKline(acc: VwapAccumulator, kline: Kline): void {
  fold(acc, {
    t: Number(kline[0]),
    high: Number(kline[2]),
    low: Number(kline[3]),
    close: Number(kline[4]),
    volume: Number(kline[5]),
  });
}

/**
 * Unquantized VWAP and population σ of hlc3
 * (`sqrt(Σs²/n − mean²)`) from an accumulator; undefined while the run
 * has no volume.
 */
function raw(
  acc: VwapAccumulator,
): { price: number; stdev: number } | undefined {
  if (acc.v <= 0 || acc.n <= 0) return undefined;
  const price = acc.pv / acc.v;
  if (!Number.isFinite(price) || price <= 0) return undefined;
  const variance = Math.max(acc.s2 / acc.n - (acc.s / acc.n) ** 2, 0);
  return { price, stdev: Math.sqrt(variance) };
}

/**
 * Derives the coin-facing `vwap` group from an accumulator. Returns
 * `undefined` when no accumulator exists, and an anchor-only group when
 * the run has no volume — absence reads as "no opinion". `price`/`stdev`
 * quantize to 4 significant digits and the pct fields to 0.1 so the delta
 * stream sees step functions instead of float churn.
 */
function derive(
  acc: VwapAccumulator | undefined,
  markPrice?: number,
  signalPrice?: number,
): CoinVwap | undefined {
  if (!acc) return undefined;
  const values = raw(acc);
  if (!values) return { anchorT: acc.aT };
  const { price, stdev } = values;

  const fields: CoinVwap = {
    anchorT: acc.aT,
    price: Number(price.toPrecision(4)),
    stdev: Number(stdev.toPrecision(4)),
    stretchPct: Number((((2 * stdev) / price) * 100).toFixed(1)),
  };

  if (Number.isFinite(markPrice)) {
    fields.distancePct = Number(
      ((((markPrice as number) - price) / price) * 100).toFixed(1),
    );
  }

  if (
    typeof signalPrice === "number" &&
    Number.isFinite(signalPrice) &&
    signalPrice > 0 &&
    stdev > 0
  ) {
    fields.dSigma = Number((Math.abs(signalPrice - price) / stdev).toFixed(2));
  }

  return fields;
}

const vwap = {
  INTERVAL,
  INTERVAL_MS,
  monthStartMs,
  accumulator: {
    create: createAccumulator,
    fold,
    foldKline,
  },
  raw,
  derive,
};

export default vwap;
