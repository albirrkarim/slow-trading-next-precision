import { VPOINT_WARMUP_MS } from "../backtest/backtest-precision-types";

import type {
  BacktestLeaderboardEntry,
  LeaderboardProfile,
} from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

const RANGE_DAYS: Record<string, number> = {
  day: 1,
  hour: 1 / 24,
  minute: 1 / 1440,
  month: 30,
  week: 7,
  year: 365,
};

interface ConfigAccountLike {
  enabled?: boolean;
  name?: string;
  sandbox?: { initialBalanceUSDT?: number | string };
  slug?: string;
}

interface ConfigLike {
  endTime?: number;
  range?: string;
  settings?: { accounts?: ConfigAccountLike[] };
  startTime?: number;
}

/** Nested getter for dotted leaf ids like "leaderboard.monthlyGain.avg". */
function nestedValue(obj: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === "object"
          ? (acc as Record<string, unknown>)[key]
          : undefined,
      obj,
    );
}

/**
 * The run's duration in days — explicit startTime/endTime first, else the
 * named range label ("1month", "6month", …). Undefined when neither resolves.
 */
function rangeDaysOf(config: unknown): number | undefined {
  const c = config as ConfigLike | undefined;
  if (
    typeof c?.startTime === "number" &&
    typeof c?.endTime === "number" &&
    c.endTime > c.startTime
  ) {
    return (c.endTime - c.startTime) / DAY_MS;
  }
  const match = c?.range?.match(/^(\d+)(minute|hour|day|week|month|year)$/);
  if (!match) return undefined;
  return Number(match[1]) * RANGE_DAYS[match[2]];
}

/** Enabled accounts of a saved config — the balances the run was sized on. */
export function enabledAccountsOf(
  entry: Pick<BacktestLeaderboardEntry, "backtestConfig">,
): ConfigAccountLike[] {
  const settings = (entry.backtestConfig as ConfigLike | undefined)?.settings;
  return (settings?.accounts ?? []).filter((account) => account.enabled);
}

/** Sum of enabled accounts' initial balances — the minimum equity the run used. */
export function minEquityOf(
  entry: Pick<BacktestLeaderboardEntry, "backtestConfig">,
): number | undefined {
  const accounts = enabledAccountsOf(entry);
  if (accounts.length === 0) return undefined;
  return accounts.reduce(
    (sum, account) => sum + (Number(account.sandbox?.initialBalanceUSDT) || 0),
    0,
  );
}

/**
 * Closed positions per day. Prefers the stored metric — whose divisor is the
 * balance-snapshot span, so it already excludes the ~2-month vPoint warm-up.
 * Entries saved before the field existed fall back to positionsClosed ÷ the
 * config's range days minus that same warm-up.
 */
function tradesPerDayOf(entry: BacktestLeaderboardEntry): number | undefined {
  const stored = entry.leaderboard?.tradesPerDay;
  if (typeof stored === "number" && Number.isFinite(stored)) return stored;
  const days = rangeDaysOf(entry.backtestConfig);
  const closed = entry.leaderboard?.positionsClosed;
  if (!days || typeof closed !== "number") return undefined;
  const tradingDays = Math.max(1, days - VPOINT_WARMUP_MS / DAY_MS);
  return closed / tradingDays;
}

/** Virtual leaf resolvers — values derived per entry, not stored fields. */
const VIRTUAL_LEAVES = new Map<
  string,
  (entry: BacktestLeaderboardEntry) => number | undefined
>([
  ["minEquity", minEquityOf],
  ["leaderboard.tradesPerDay", tradesPerDayOf],
]);

/** Reads one leaf column value — virtual leaves first, then nested metric. */
export function readLeaf(
  entry: BacktestLeaderboardEntry,
  fieldId: string,
): unknown {
  return VIRTUAL_LEAVES.get(fieldId)?.(entry) ?? nestedValue(entry, fieldId);
}

/** Leaf columns where a lower value is better (gradient/score inverted). */
export const LOWER_IS_BETTER: ReadonlySet<string> = new Set([
  "minEquity",
  "leaderboard.maxFloatingDrawdown.avg",
  "leaderboard.maxFloatingDrawdown.max",
  "leaderboard.maxFloatingDrawdownUsdt.avg",
  "leaderboard.maxFloatingDrawdownUsdt.max",
  "leaderboard.maxPortfolioDrawdown.avg",
  "leaderboard.maxPortfolioDrawdown.max",
  "leaderboard.emptyBalance.min",
  "leaderboard.emptyBalance.avg",
  "leaderboard.emptyBalance.max",
]);

/** Every numeric leaf a profile may weight — label is the column's short name. */
export const PROFILE_METRICS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "minEquity", label: "Min Equity" },
  { id: "leaderboard.gainPct", label: "Gain" },
  { id: "leaderboard.winRate", label: "Win Rate" },
  { id: "leaderboard.positionsClosed", label: "Trades" },
  { id: "leaderboard.tradesPerDay", label: "Trades/Day" },
  { id: "leaderboard.sharpeRatio", label: "Sharpe" },
  { id: "leaderboard.maxPortfolioDrawdown.avg", label: "Portfolio DD avg" },
  { id: "leaderboard.maxPortfolioDrawdown.max", label: "Portfolio DD max" },
  { id: "leaderboard.maxFloatingDrawdown.avg", label: "Floating DD avg pct" },
  { id: "leaderboard.maxFloatingDrawdown.max", label: "Floating DD max pct" },
  { id: "leaderboard.maxFloatingDrawdownUsdt.avg", label: "Floating DD avg usd" },
  { id: "leaderboard.maxFloatingDrawdownUsdt.max", label: "Floating DD max usd" },
  { id: "leaderboard.bearMarketProofRatio", label: "Bear Proof" },
  { id: "leaderboard.monthlyGain.min", label: "Monthly Gain min" },
  { id: "leaderboard.monthlyGain.avg", label: "Monthly Gain avg" },
  { id: "leaderboard.monthlyGain.max", label: "Monthly Gain max" },
  { id: "leaderboard.avgMonthlyProfitPct", label: "Avg Monthly" },
  { id: "leaderboard.balanceTradesScore", label: "Trades Bal" },
  { id: "leaderboard.capitalEfficiency.hrScore", label: "Capital Eff HR" },
  { id: "leaderboard.capitalEfficiency.trScore", label: "Capital Eff TR" },
  { id: "leaderboard.capitalEfficiency.score", label: "Capital Eff" },
  { id: "leaderboard.emptyBalance.min", label: "Empty Balance min" },
  { id: "leaderboard.emptyBalance.avg", label: "Empty Balance avg" },
  { id: "leaderboard.emptyBalance.max", label: "Empty Balance max" },
];

const PROFILE_METRIC_IDS = new Set(PROFILE_METRICS.map((metric) => metric.id));

export function isProfileMetricId(id: string): boolean {
  return PROFILE_METRIC_IDS.has(id);
}

export interface EntryScore {
  /** Weighted composite on a 0-100 scale (can dip below 0 with negative weights). */
  score: number;
  /** Per-metric weighted contribution (normalized value × weight), for explainability. */
  parts: Record<string, number>;
}

/**
 * Scores every entry against a profile's weights.
 *
 * Each metric is min-max normalized across the listed entries after direction
 * correction (metrics in LOWER_IS_BETTER flip so 1 always means best). A
 * metric with identical values — or missing on an entry — contributes a
 * neutral 0.5. The score is Σ(w·n) / Σ|w| × 100.
 */
export function scoreEntries(
  entries: BacktestLeaderboardEntry[],
  weights: Record<string, number>,
): Map<string, EntryScore> {
  const metrics = Object.entries(weights).filter(
    ([id, weight]) => isProfileMetricId(id) && Number.isFinite(weight),
  );
  const result = new Map<string, EntryScore>();
  if (metrics.length === 0) {
    for (const entry of entries) result.set(entry.id, { parts: {}, score: 0 });
    return result;
  }

  const totalWeight = metrics.reduce(
    (sum, [, weight]) => sum + Math.abs(weight),
    0,
  );
  if (totalWeight === 0) {
    for (const entry of entries) result.set(entry.id, { parts: {}, score: 0 });
    return result;
  }

  const normalized = new Map<string, Map<string, number>>();
  for (const [id] of metrics) {
    const values = entries.map((entry) => readLeaf(entry, id));
    const numeric = values.filter(
      (value): value is number =>
        typeof value === "number" && Number.isFinite(value),
    );
    const min = numeric.length ? Math.min(...numeric) : 0;
    const max = numeric.length ? Math.max(...numeric) : 0;
    const invert = LOWER_IS_BETTER.has(id);
    const scale = new Map<string, number>();
    for (const [index, entry] of entries.entries()) {
      const value = values[index];
      let n: number;
      if (typeof value !== "number" || !Number.isFinite(value) || max === min) {
        n = 0.5;
      } else {
        const ratio = (value - min) / (max - min);
        n = invert ? 1 - ratio : ratio;
      }
      scale.set(entry.id, n);
    }
    normalized.set(id, scale);
  }

  for (const entry of entries) {
    const parts: Record<string, number> = {};
    let sum = 0;
    for (const [id, weight] of metrics) {
      const contribution = (normalized.get(id)?.get(entry.id) ?? 0.5) * weight;
      parts[id] = Number(contribution.toFixed(4));
      sum += contribution;
    }
    result.set(entry.id, {
      parts,
      score: Number(((sum / totalWeight) * 100).toFixed(2)),
    });
  }
  return result;
}

/** One-line scoring description returned to agents over MCP. */
export const SCORING_METHOD =
  "Each metric is min-max normalized across the listed entries (0=worst, 1=best) after direction correction — lower-is-better metrics (minEquity, drawdowns, emptyBalance) are flipped so 1 always means best. Missing or flat metrics score a neutral 0.5. score = Σ(weight × normalized) / Σ|weight| × 100.";

/** Compact profile description returned to agents over MCP. */
export function describeProfile(profile: LeaderboardProfile) {
  return {
    name: profile.name,
    scoring: SCORING_METHOD,
    weights: profile.weights,
  };
}
