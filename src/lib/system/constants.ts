/**
 * Percentage move required to activate volatility detection. Used by both
 * backtest and production so the result stays identical across runtimes.
 */
// BOTH:GLOBAL_VOLATILITY_THRESHOLD
export const VOLATILITY_THRESHOLD = process.env.VOLATILITY_THRESHOLD
  ? Number.parseInt(process.env.VOLATILITY_THRESHOLD, 10)
  : 5; // in percent

/**
 * Percent retrace from the local extreme that confirms a vPoint pivot.
 * Shared by backtest and production so detection stays identical across
 * runtimes.
 */
export const VOLATILITY_RETRACE_PERCENT = process.env
  .VOLATILITY_RETRACE_PERCENT
  ? Number.parseFloat(process.env.VOLATILITY_RETRACE_PERCENT)
  : 1; // in percent

const HALF_HOUR_MS = 1000 * 60 * 30;
const HOUR_MS = HALF_HOUR_MS * 2;
const DAY_MS = HOUR_MS * 24;

/** Named time windows in milliseconds for dashboard polling and lookbacks. */
export const windowsMs: Record<string, number> = {
  "5y": DAY_MS * 365 * 5,
  "1y": DAY_MS * 365,
  "6m": DAY_MS * 30 * 6,
  "3m": DAY_MS * 30 * 3,
  "1m": DAY_MS * 30,
  "1w": DAY_MS * 7,
  "3d": DAY_MS * 3,
  "2d": DAY_MS * 2,
  "1d": DAY_MS,
  "6h": HOUR_MS * 6,
  "3h": HOUR_MS * 3,
  "1h": HOUR_MS,
  "30min": HALF_HOUR_MS,
  "15min": HALF_HOUR_MS / 2,
  "10min": 1000 * 60 * 10,
  "5min": 1000 * 60 * 5,
};

/** Decision-engine choices shown in management settings. */
export const DECISION_MODELS = [
  {
    name: "decision.v20 - Direct level entry",
    value: "decision.v20",
    descrption:
      "Enter every unused vPoint at or above the minimum actionable absolute level",
  },
];
