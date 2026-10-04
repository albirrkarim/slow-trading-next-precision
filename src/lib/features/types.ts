/**
 * Feature-store types for the runtime's `state.features` slot. Everything in
 * `src/lib/features` is pure, environment-neutral math — it reads runtime
 * state/config and writes `state.features`, never performs I/O, and never
 * imports an environment adapter.
 */

/**
 * Pivot envelope window every pivot-derived feature reads from
 * `state.vPointsMap`. Matches the ~2-month volatility warm-up lookback
 * (`VPOINT_INITIAL_LOOKBACK_MINUTES`) so warm-up seeding and retention share
 * one span and features are defined from the first trading tick.
 */
export const FEATURES_VPOINT_WINDOW_MS = 2 * 30 * 24 * 60 * 60 * 1000;

/**
 * Rolling window for per-coin feature history trails (e.g.
 * `priceNormalizedHistory`) — keeps roughly the recent decision horizon.
 */
export const FEATURES_HISTORY_WINDOW_MS = 20 * 24 * 60 * 60 * 1000;

/** Compact feature-history sample: the value `p` observed at time `t` (ms). */
export interface FeatureHistoryPoint {
  t: number;
  p: number;
}

/**
 * Per-symbol feature values keyed by feature name. Sparse by design:
 * features derived from pivot prices only move when a new vPoint forms.
 */
export interface CoinFeatures {
  /**
   * Position of the latest pivot price inside the trailing pivot-price
   * envelope: `0` = range floor, `1` = range top, `>1`/`<0` = pivot formed
   * beyond the prior envelope (breakout), `0.5` = flat/degenerate range.
   * Quantized to 3 decimals. Undefined until at least two earlier pivots
   * exist in the window — absence means "no opinion", never a block.
   */
  priceNormalized?: number;

  /**
   * Rolling trail of `priceNormalized` change points within the last
   * `FEATURES_HISTORY_WINDOW_MS` (~10 days). Appends only when the value
   * changes (it is a step function); the last surviving point is kept even
   * when older than the window so "unchanged since t" stays readable.
   */
  priceNormalizedHistory: FeatureHistoryPoint[];

  [feature: string]: number | FeatureHistoryPoint[] | undefined;
}

/** Feature store carried on `RuntimeEngineState.features`. */
export interface RuntimeFeatures {
  /** Global/cross-coin features. */
  shared: Record<string, number>;
  /** Per-symbol features keyed by base symbol (same keys as vPointsMap). */
  coins: Record<string, CoinFeatures>;
}

/**
 * Entry-gate bounds on `priceNormalized`. Bounds are strategy-owned
 * constants (see `default_with_features_gate`), not settings — a candidate
 * is rejected when its coin's value falls outside `[min, max]` or when the
 * BTC market anchor sits outside `[btcMin, btcMax]`. Undefined feature
 * values never block — absence is "no opinion".
 */
export interface FeatureGateBounds {
  minPriceNormalized?: number;
  maxPriceNormalized?: number;
  btcMinPriceNormalized?: number;
  btcMaxPriceNormalized?: number;
  /**
   * How many recent days of the `priceNormalizedHistory` trail the gate
   * judges. The record itself keeps the full
   * `FEATURES_HISTORY_WINDOW_MS` (~10 days) for display; only samples
   * newer than `now - historyWindowDays` count as violations.
   */
  historyWindowDays?: number;
}
