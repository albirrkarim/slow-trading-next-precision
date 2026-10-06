/**
 * Feature-store types for the runtime's `state.features` slot. Everything in
 * `src/lib/features` is environment-neutral — no file here imports an
 * environment adapter. `features.update` is pure: it reads runtime state and
 * writes `state.features`. `features.refresh` is the adapter-facing
 * orchestration step — it feeds feature inputs through the injected
 * `context.helper.market` (the only I/O, engine-owned) before calling
 * `update`.
 */

import type { VolatilityPoint } from "@/lib/system/types/market";

/**
 * Pivot envelope window every pivot-derived feature reads from
 * `state.vPointsMap`. Matches the ~2-month volatility warm-up lookback
 * (`VPOINT_INITIAL_LOOKBACK_MINUTES`) so warm-up seeding and retention share
 * one span and features are defined from the first trading tick.
 */
export const FEATURES_VPOINT_WINDOW_MS = 2 * 30 * 24 * 60 * 60 * 1000;

/**
 * Rolling window for per-coin feature history trails (e.g.
 * `priceNormalized.history`) — keeps roughly the recent decision horizon.
 */
export const FEATURES_HISTORY_WINDOW_MS = 20 * 24 * 60 * 60 * 1000;

/** Compact feature-history sample: the value `p` observed at time `t` (ms). */
export interface FeatureHistoryPoint {
  t: number;
  p: number;
}

/**
 * Running fold of hlc3 candles for the monthly-anchored VWAP — the raw
 * substrate the derived `vwap` group is computed from. Written by the
 * feature feed (`features.vwap-feed` inside `refresh`), never by
 * `features.update`: accumulators must survive the per-pass `coins`
 * rebuild. Sums restart at each UTC month boundary.
 */
export interface VwapAccumulator {
  /** UTC month-start (ms) the sums belong to. */
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
 * Grouped `priceNormalized` feature — the current envelope reading plus its
 * recorded change trail. `update` reuses the previous group object when both
 * members are unchanged so `changedCoins` identity-diffing stays sparse.
 */
export interface CoinPriceNormalized {
  /**
   * Position of the latest pivot price inside the trailing pivot-price
   * envelope: `0` = range floor, `1` = range top, `>1`/`<0` = pivot formed
   * beyond the prior envelope (breakout), `0.5` = flat/degenerate range.
   * Quantized to 3 decimals. Undefined until at least two earlier pivots
   * exist in the window — absence means "no opinion", never a block.
   */
  current?: number;

  /**
   * Rolling trail of `priceNormalized` change points within the last
   * `FEATURES_HISTORY_WINDOW_MS` (~20 days). Appends only when the value
   * changes (it is a step function); the last surviving point is kept even
   * when older than the window so "unchanged since t" stays readable.
   */
  history: FeatureHistoryPoint[];
}

/**
 * Grouped monthly-anchored VWAP feature — derived each pass from the
 * `RuntimeFeatures.vwap` accumulator. The mark-driven fields move every
 * pass, so `changedCoins` excludes the whole group: it rides along in any
 * record a real change triggers but never triggers one itself.
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
}

/**
 * Per-symbol feature values grouped by feature name. Sparse by design:
 * features derived from pivot prices only move when a new vPoint forms.
 */
export interface CoinFeatures {
  /**
   * Latest vPoint in `vPointsMap` for this coin at refresh time. Excluded
   * from `changedCoins` diffs — it mutates every pass. Entry commits clone
   * it, so position snapshots freeze the entry-time signal point (incl.
   * `p`).
   */
  latestVpoint?: VolatilityPoint;

  priceNormalized: CoinPriceNormalized;

  vwap?: CoinVwap;

  [feature: string]: any;
}

/** Feature store carried on `RuntimeEngineState.features`. */
export interface RuntimeFeatures {
  /** Global/cross-coin features. */
  shared: Record<string, number>;
  /** Per-symbol features keyed by base symbol (same keys as vPointsMap). */
  coins: Record<string, CoinFeatures>;
  /**
   * VWAP accumulators keyed by base symbol. Written by the feature feed
   * (`vwap-feed` kline I/O), read by `features.update` — kept outside
   * `coins` because that map is rebuilt wholesale every pass.
   */
  vwap?: Record<string, VwapAccumulator>;
}
