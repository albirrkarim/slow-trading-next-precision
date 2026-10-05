/** Min/avg/max triple shared by duration and percent leaderboard metrics. */
export interface LeaderboardRange {
  avg: number;
  max: number;
  min: number;
}

/**
 * Evaluation metrics computed from one precision backtest result. Mirrors the
 * column set of the legacy leaderboard while sourcing every value from the
 * precision engine's positions and balance snapshots.
 */
export interface BacktestLeaderboardMetrics {
  /** Average monthly realized profit as a percentage of the starting balance. */
  avgMonthlyProfitPct: number;
  /** Evenness of closed trades across symbols, 0..1 (exp(-CV)). */
  balanceTradesScore: number;
  /**
   * Mean portfolio resilience inside detected bear windows, in percent.
   * 100 = no floating drag; higher is better; 0 when no bear window exists.
   */
  bearMarketProofRatio: number;
  /**
   * Compound annual growth rate, percent per year:
   * (finalTotal / startingBalance)^(365.25 / spanDays) − 1, where spanDays is
   * the balance-timeline span (vPoint warm-up already excluded). −100 when
   * the final total reaches 0. Sub-year runs extrapolate steeply — compare
   * only across similar spans.
   */
  cagrPct?: number;
  capitalEfficiency: {
    /** 1 - time-weighted locked/total ratio; higher = less stuck capital. */
    hrScore: number;
    /** Combined 0..1 score (hrScore + trScore) / 2. */
    score: number;
    /** Locked-capital turnover per day normalized to 1; higher = faster. */
    trScore: number;
  };
  /** Durations in ms the combined spendable balance stayed below trading minimum. */
  emptyBalance: LeaderboardRange;
  /** (finalTotal - startingBalance) / startingBalance * 100. */
  gainPct: number;
  /** Per-position deepest dip vs deployed notional: -pnl.maxDownPct / 100. */
  maxFloatingDrawdown: LeaderboardRange;
  /** Per-position worst USDT dip, un-normalized: -pnl.maxDownUsdt. */
  maxFloatingDrawdownUsdt: LeaderboardRange;
  /**
   * Per-UTC-day aggregate floating loss, in USDT. Each day sums every open
   * position's worst `pnl.history` usdt sample that day (losses only), negated
   * to a loss magnitude; the range runs over days that had samples.
   */
  dailyFloatingDrawdownUsdt?: LeaderboardRange;
  /** Per-position worst USDT dip / mean total balance: -pnl.maxDownUsdt / avgTotal. */
  maxPortfolioDrawdown: LeaderboardRange;
  /** Realized monthly profit / month-start total, in percent. */
  monthlyGain: LeaderboardRange;
  positionsClosed: number;
  /** Monthly-return Sharpe ratio (mean / stddev, no annualization). */
  sharpeRatio: number;
  /**
   * Closed positions per day over the balance-snapshot span — the effective
   * trading window, which already excludes the ~2-month vPoint warm-up.
   */
  tradesPerDay?: number;
  /** Winning closed positions / total closed positions * 100. */
  winRate: number;
}

/**
 * A named weighted-metric view of the leaderboards. `weights` maps leaf ids
 * (the column ids such as "leaderboard.sharpeRatio", "minEquity",
 * "leaderboard.tradesPerDay") to a signed importance — positive rewards the
 * metric, negative penalizes it. Scoring normalizes every metric min-max
 * across the listed entries after direction correction, so weights are pure
 * relative importance.
 */
export interface LeaderboardProfile {
  name: string;
  /** Creation/update timestamp in ms. */
  t: number;
  weights: Record<string, number>;
}

/** One saved leaderboard record persisted at storage/leaderboards/results/<id>.json. */
export interface BacktestLeaderboardEntry {
  /** Short content hash — re-saving the same config+range overwrites. */
  id: string;
  /** Creation timestamp in ms. */
  t: number;
  /** Result-cache key the metrics were computed from, when available. */
  cacheKey?: string;
  /** User-marked favorite flag; absent when not favorited to keep files compact. */
  favorite?: boolean;
  label?: string;
  /** The BacktestConfig used for the run, including `settings` (ConfigDraft). */
  backtestConfig: unknown;
  leaderboard: BacktestLeaderboardMetrics;
}
