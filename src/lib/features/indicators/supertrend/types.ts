/** Supertrend indicator types — config, running state, and per-coin reading. */

import type { FeatureIndicatorBase } from "../types";

/** TradingView Supertrend: hl2 ± factor × RMA-ATR with ratcheting bands. */
export interface SupertrendFeatureConfig extends FeatureIndicatorBase {
  type: "supertrend";
  /** ATR (RMA) length in candles. */
  atrLength: number;
  /** Band distance in ATRs. */
  factor: number;
}

/**
 * Running Supertrend state for one symbol. Persisted in `features.json`
 * (compact keys).
 */
export interface SupertrendAccumulator {
  /** Open time (ms) of the last folded candle — incremental cursor. */
  t: number;
  /** Candles folded. ATR exists once `n >= atrLength`. */
  n: number;
  /** Σ true range while seeding the first ATR (SMA seed of the RMA). */
  tr: number;
  /** Wilder RMA of true range. */
  atr: number;
  /** Previous candle close. */
  pc: number;
  /** Final upper band of the previous candle. */
  ub: number;
  /** Final lower band of the previous candle. */
  lb: number;
  /** Trend: 1 = up (line = lower band), -1 = down (line = upper band). */
  d: 1 | -1;
  /** Open time (ms) of the candle that last flipped `d`; 0 = no flip yet. */
  fT: number;
}

/** Derived per-coin Supertrend reading (`coins[s].ind.supertrend.<id>`). */
export interface CoinSupertrend {
  /** 1 = uptrend, -1 = downtrend. */
  d: 1 | -1;
  /** Supertrend line price, 5 significant digits. */
  l: number;
  /** Signed mark distance from the line, pct, 0.1 steps. */
  dPct?: number;
  /** Open time (ms) of the flip candle that started the current trend. */
  fT?: number;
}
