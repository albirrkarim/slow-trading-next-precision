/**
 * Shared indicator constants — a leaf module so per-type definitions,
 * the registry, and config can all import it without cycles.
 */

import type { FeatureIndicatorInterval } from "./types";

const MINUTE_MS = 60_000;

/** Interval → candle width (ms). */
export const INDICATOR_INTERVAL_MS: Record<FeatureIndicatorInterval, number> = {
  "1m": MINUTE_MS,
  "5m": 5 * MINUTE_MS,
  "15m": 15 * MINUTE_MS,
  "30m": 30 * MINUTE_MS,
  "1h": 60 * MINUTE_MS,
  "2h": 120 * MINUTE_MS,
  "4h": 240 * MINUTE_MS,
  "1d": 1440 * MINUTE_MS,
};

export const INDICATOR_INTERVALS = Object.keys(
  INDICATOR_INTERVAL_MS,
) as FeatureIndicatorInterval[];

/** Id the feature gates (v2–v5) read their monthly VWAP from. */
export const GATE_VWAP_ID = "vwap";

/** Upper bound on configured instances — each one costs a fold per candle. */
export const MAX_INDICATORS = 24;

/** Instance id rule: a letter first, then lowercase letters, digits, `_`. */
export const INDICATOR_ID_PATTERN = /^[a-z][a-z0-9_]{0,15}$/;

/**
 * Longest history any instance may warm up from. Backtests start trading
 * two months after their dataset start (the vPoint warm-up), so warm-ups
 * must fit inside that window or the dataset reader has no candles.
 */
export const MAX_INDICATOR_WARMUP_MS = 55 * 24 * 60 * 60_000;
