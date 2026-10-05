/**
 * Entry-gate bounds on `priceNormalized`. Bounds are strategy-owned
 * constants (see `default_with_features_gate`), not settings — a candidate
 * is rejected when its coin's value falls outside `[min, max]` or when the
 * BTC market anchor sits outside `[btcMin, btcMax]`. Undefined feature
 * values never block — absence is "no opinion".
 */
export interface FeatureGateBounds {

  btcMinPriceNormalized?: number;
  btcMaxPriceNormalized?: number;

  minPriceNormalized?: number;
  maxPriceNormalized?: number;
}

/**
 * Bounds this strategy enforces on the `priceNormalized` feature —
 * strategy-owned policy, deliberately hardcoded here instead of living in
 * settings so the gate can grow richer rules (e.g. the history excursion
 * check below) without config plumbing.
 *
 * - Coin zone `[0.2, 0.8]`: below 0.2 the candidate's latest pivot scraped
 *   the 2-month envelope floor (breakdown risk); above 0.8 it formed near
 *   the top (chasing).
 * - BTC zone `[0.3, 0.8]`: a market-context veto applied to EVERY
 *   candidate — BTC is always tracked in `state.vPointsMap` as the
 *   volatility anchor even when it is not a traded symbol, so below 0.3
 *   means the market is breaking down and above 0.8 means it is extended.
 *
 * Both bounds apply to the recent portion of `priceNormalizedHistory`,
 * not just the current value — a coin that touched outside its zone
 * within `historyWindowDays` is rejected even when it has since moved
 * back inside. The recorded trail itself keeps the full 20-day window
 * (`FEATURES_HISTORY_WINDOW_MS`); the gate only judges its freshest days.
 */
export const FEATURE_GATE_BOUNDS: Required<FeatureGateBounds> = {
  // coin
  maxPriceNormalized: 0.8,
  minPriceNormalized: 0.3,

  // btc
  btcMaxPriceNormalized: 0.8,
  btcMinPriceNormalized: 0.3,
};

/**
 * Deep-run repetition limit mined from `storage/analysis/case1`: a level-1
 * entry whose previous same-side run already reached `|lvl| >= 4`
 * escalates again at roughly 4x the ~1.2% base rate — the only
 * sequence feature that separated at all. Coverage is small (catches a
 * few percent of escalations) but the collateral is near zero, so the
 * guard stays cheap. Applies only to `|lvl| === 1` candidates — the
 * level the user asked to protect; deeper entries are untouched.
 */
export const PREV_RUN_DEPTH_LIMIT = 4;