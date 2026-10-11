/** VWAP indicator types — config, running state, and per-coin reading. */

import type { FeatureIndicatorBase } from "../types";

/** Session/week/month reset boundaries (UTC) for the VWAP indicator. */
export type FeatureVwapAnchor = "session" | "week" | "month";

/** Anchored VWAP (hlc3, volume-weighted) with population σ of hlc3. */
export interface VwapFeatureConfig extends FeatureIndicatorBase {
  type: "vwap";
  anchor: FeatureVwapAnchor;
}

/**
 * Running fold of hlc3 candles for an anchored VWAP indicator — the raw
 * substrate a `vwap` reading is derived from. Written by the indicator
 * feed (`features/indicators/feed` inside `refresh`), never by
 * `features.update`: accumulators must survive the per-pass `coins`
 * rebuild. Sums restart at each anchor boundary.
 */
export interface VwapAccumulator {
  /** UTC anchor-period start (ms) the sums belong to. */
  aT: number;
  /** Σ hlc3·volume since anchor. */
  pv: number;
  /** Σ volume since anchor. */
  v: number;
  /** Σ hlc3 since anchor (σ input). */
  s: number;
  /** Σ hlc3² since anchor (σ input). */
  s2: number;
  /** Candles folded since anchor. */
  n: number;
  /** Open time (ms) of the last folded candle — incremental cursor. */
  t: number;
}

/**
 * Anchored VWAP reading — `coins[s].ind.vwap.<id>`, derived each pass from
 * the instance's accumulator. The mark-driven fields move every pass, so
 * VWAP never triggers a `changedCoins` record on its own; it rides along
 * in any record a real change triggers. Older snapshots carry the same
 * shape at `coins[s].vwap` — read through `indicators.read.vwap`.
 */
export interface CoinVwap {
  /**
   * Monthly-anchored VWAP (Σ hlc3·vol / Σvol since `anchorT`). Quantized to
   * 4 significant digits so it records as a step function in the delta
   * stream. Absent until the accumulator carries volume.
   */
  price?: number;

  /**
   * Population standard deviation of hlc3 since `anchorT`
   * (`sqrt(Σs²/n − mean²)`) — the σ the VWAP-band distances are measured
   * in. Same quantization cadence as `price`.
   */
  stdev?: number;

  /**
   * Signed distance of the latest mark price from `price`, percent:
   * `(mark − price)/price × 100`. Quantized to 0.1 steps.
   */
  distancePct?: number;

  /**
   * Envelope width: `2σ/price × 100` — how stretched the monthly VWAP
   * bands are as a share of price. Quantized to 0.1 steps.
   */
  stretchPct?: number;


  /** UTC month-start (ms) the VWAP run belongs to. */
  anchorT?: number;

  /**
   * σ-distance of the coin's `latestVpoint` from `price`:
   * `|latestVpoint.p − price| / stdev`, quantized to 0.01 steps. Absent
   * without σ data or a valid point — gates and previews read it directly
   * instead of recomputing.
   */
  dSigma?: number;
}
