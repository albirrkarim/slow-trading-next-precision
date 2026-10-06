/**
 * Monthly-anchored VWAP feature math — pure functions, no I/O. The
 * feature feed (`features/vwap-feed`) folds closed klines into the
 * `state.features.vwap` accumulator; `features.update` derives the
 * per-coin `vwap*` fields consumed by gates and snapshots.
 */
import type { Kline } from "@/lib/system/types/market";
import type { CoinFeatures, VwapAccumulator } from "./types";

/** UTC month-start (ms) containing `timeMs` — the VWAP anchor boundary. */
function monthStartMs(timeMs: number): number {
  const d = new Date(timeMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

/** Fresh zeroed accumulator anchored at `anchorMs`. */
function createAccumulator(anchorMs: number): VwapAccumulator {
  return { aT: anchorMs, n: 0, pv: 0, s: 0, s2: 0, t: 0, v: 0 };
}

/**
 * Folds one kline into the accumulator: `hlc3` feeds both the weighted
 * mean (`pv`/`v`, volume-gated — a candle nobody traded cannot move the
 * average) and the population σ sums (`s`/`s2`/`n`). Advances `acc.t` to
 * the candle's open time.
 */
function foldKline(acc: VwapAccumulator, kline: Kline): void {
  const high = Number(kline[2]);
  const low = Number(kline[3]);
  const close = Number(kline[4]);
  const volume = Number(kline[5]);
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
  acc.t = Number(kline[0]);
}

/**
 * Derives the coin-facing `vwap*` fields from an accumulator. Returns
 * empty fields when the run has no volume — absence reads as "no opinion".
 * `vwap`/`vwapStdev` quantize to 4 significant digits and the pct fields
 * to 0.1 so the delta stream sees step functions instead of float churn.
 */
function derive(
  acc: VwapAccumulator | undefined,
  markPrice?: number,
): Pick<
  CoinFeatures,
  | "vwap"
  | "vwapStdev"
  | "vwapDistancePct"
  | "vwapStretchPct"
  | "vwapAnchorT"
> {
  if (!acc) return {};
  if (acc.v <= 0 || acc.n <= 0) return { vwapAnchorT: acc.aT };

  const price = acc.pv / acc.v;
  if (!Number.isFinite(price) || price <= 0) return { vwapAnchorT: acc.aT };

  const variance = Math.max(acc.s2 / acc.n - (acc.s / acc.n) ** 2, 0);
  const stdev = Math.sqrt(variance);

  const fields: Pick<
    CoinFeatures,
    | "vwap"
    | "vwapStdev"
    | "vwapDistancePct"
    | "vwapStretchPct"
    | "vwapAnchorT"
  > = {
    vwap: Number(price.toPrecision(4)),
    vwapAnchorT: acc.aT,
    vwapStdev: Number(stdev.toPrecision(4)),
    vwapStretchPct: Number((((2 * stdev) / price) * 100).toFixed(1)),
  };

  if (Number.isFinite(markPrice)) {
    fields.vwapDistancePct = Number(
      ((((markPrice as number) - price) / price) * 100).toFixed(1),
    );
  }

  return fields;
}

const vwap = {
  monthStartMs,
  accumulator: {
    create: createAccumulator,
    foldKline,
  },
  derive,
};

export default vwap;
