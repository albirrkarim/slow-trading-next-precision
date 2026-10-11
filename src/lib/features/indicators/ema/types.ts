/** EMA indicator types — config, running state, and per-coin reading. */

import type { FeatureIndicatorBase } from "../types";

/** Candle price an EMA averages. */
export type EmaSource = "close" | "hl2" | "hlc3";

/** TradingView `ta.ema`: α = 2 / (length + 1), seeded with the first source value. */
export interface EmaFeatureConfig extends FeatureIndicatorBase {
  type: "ema";
  /** Length in candles. */
  length: number;
  source: EmaSource;
}

/**
 * Running EMA state for one symbol. Persisted in `features.json` (compact
 * keys).
 */
export interface EmaAccumulator {
  /** Open time (ms) of the last folded candle — incremental cursor. */
  t: number;
  /** Candles folded. The reading appears once `n >= length`. */
  n: number;
  /** Current EMA. */
  e: number;
  /** EMA after the previous candle (slope input). */
  pe: number;
}

/** Derived per-coin EMA reading (`coins[s].ind.ema.<id>`). */
export interface CoinEma {
  /** EMA value, 5 significant digits. */
  v: number;
  /** Signed mark distance from the EMA, pct, 0.1 steps. */
  dPct?: number;
  /** Last candle's EMA change, pct, 0.01 steps — the slope. */
  sPct?: number;
}
