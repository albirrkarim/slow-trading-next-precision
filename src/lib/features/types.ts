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

import type {
  CoinIndicators,
  CoinVwap,
  FeatureIndicatorDefs,
  IndicatorAccumulator,
} from "./indicators/types";

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
 * Grouped `priceNormalized` feature — the current envelope reading, its
 * recorded change trail, and scores derived from that trail. `update` reuses
 * the previous group when these values are unchanged so `changedCoins`
 * identity-diffing stays sparse.
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

  /**
   * Trend clarity of `history` in [-1, +1] — `priceNorm.trend` (efficiency
   * ratio, net move over path): near ±1 is a clean traverse, ~0 is
   * sideways. Optional for legacy snapshots recorded before the field
   * existed.
   */
  trend?: number;

  /**
   * Direction-agnostic exhaustion of the recorded history in [0, 1] —
   * stalled extremes, early turns, or a repeatedly visited range breaking
   * away from its extreme.
   * Undefined until the trail is long enough; optional in older snapshots.
   */
  exhaustion?: number;
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

  /**
   * Dynamic indicator readings, `ind.<type>.<id>` (e.g.
   * `ind.supertrend.st15.d`). Ids and params come from
   * `management.indicators`; the matching definitions ride along in
   * `RuntimeFeatures.defs`.
   */
  ind?: CoinIndicators;

  /**
   * @deprecated Pre-indicator monthly VWAP group, kept only on snapshots
   * recorded before `ind` existed. Read via `indicators.read.vwap`.
   */
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
   * Indicator running state: `acc[paramsKey][symbol]`. Written by the
   * indicator feed, read by `features.update` — kept outside `coins`
   * because that map is rebuilt wholesale every pass. Keyed by params (not
   * id) so renames never re-warm. Dropped from position snapshots.
   */
  acc?: Record<string, Record<string, IndicatorAccumulator>>;
  /**
   * Enabled indicator definitions keyed by id — what each `ind.<type>.<id>`
   * meant when it was computed. Copied into every entry snapshot.
   */
  defs?: FeatureIndicatorDefs;
}
