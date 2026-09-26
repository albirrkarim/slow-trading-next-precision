import type { VolatilityPoint } from "@/lib/system/types";

import pairVPoints from "./pairs";
import pairTrades from "./trade-pairs";
import type { PrecisionCheckerRunResult } from "../types";

/** Divergence severity of one row — magnitude only; sign never softens it. */
export type MetricSeverity = "none" | "match" | "minor" | "major";

/** One rendered production↔backtest comparison row. */
export interface PrecisionCheckerMetricRow {
  key: string;
  metric: string;
  initial: string;
  production: string;
  backtest: string;
  diff: string;
  severity: MetricSeverity;
}

/** One aspect of the comparison (balance, trades, vPoints) with a score card. */
export interface PrecisionCheckerMetricCategory {
  key: string;
  title: string;
  /** 0-100 precision score; null when no row in the category could be scored. */
  score: number | null;
  severity: MetricSeverity;
  rows: PrecisionCheckerMetricRow[];
}

/** Categorized metrics plus the aggregate score across all aspects. */
export interface PrecisionCheckerMetrics {
  /** Mean of the category scores — equal weight per aspect. */
  overall: { score: number | null; severity: MetricSeverity };
  categories: PrecisionCheckerMetricCategory[];
}

/** Points contributed per row severity — divergence magnitude only. */
const ROW_SCORE: Record<MetricSeverity, number | null> = {
  none: null,
  match: 100,
  minor: 60,
  major: 0,
};

/** Bands a 0-100 score into a severity: >=90 match, >=60 minor, else major. */
function scoreSeverity(score: number | null): MetricSeverity {
  if (score == null) return "none";
  if (score >= 90) return "match";
  if (score >= 60) return "minor";
  return "major";
}

/** Scores a category: mean of row scores, severity banded at 90/60. */
function toCategory(
  key: string,
  title: string,
  rows: PrecisionCheckerMetricRow[],
): PrecisionCheckerMetricCategory {
  const scored = rows
    .map((row) => ROW_SCORE[row.severity])
    .filter((score): score is number => score != null);
  const score =
    scored.length === 0
      ? null
      : Math.round(scored.reduce((a, b) => a + b, 0) / scored.length);
  return { key, title, score, severity: scoreSeverity(score), rows };
}

// Severity bands on the absolute diff: below `minor` = match (green), below
// `major` = minor (orange), otherwise major (red). A favorable direction is
// still divergence — precision cares that backtest matches production.
const BANDS = {
  /** End-balance |pct diff|. */
  balancePct: { minor: 0.5, major: 2 },
  /** Count diffs (trades, vPoints per symbol): 0 match, 1 minor, 2+ major. */
  count: { minor: 0.5, major: 1.5 },
  /** Unpaired leftovers: 0 match, 1-2 minor, 3+ major. */
  unpaired: { minor: 0.5, major: 2.5 },
  /** Mean minute diffs (entry/exit/averaging/vPoint). */
  minutes: { minor: 1, major: 5 },
  /** Mean |price pct diff|. */
  pricePct: { minor: 0.05, major: 0.25 },
  /** Mean averaging-count diff per pair. */
  averagingCount: { minor: 0.25, major: 1 },
  /** Exit-reason mismatch rate in pct. */
  mismatchPct: { minor: 10, major: 33 },
  /** Mean |netUsdt diff| per pair. */
  pnlUsdt: { minor: 0.5, major: 2 },
  /** Mean |netPct diff| per pair in pct points. */
  pnlPct: { minor: 0.1, major: 0.5 },
} as const;

function severityOf(
  value: number | null | undefined,
  bands: { minor: number; major: number },
): MetricSeverity {
  if (typeof value !== "number" || !Number.isFinite(value)) return "none";
  const abs = Math.abs(value);
  if (abs < bands.minor) return "match";
  if (abs < bands.major) return "minor";
  return "major";
}

function formatUsdt(value?: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? `$${value.toFixed(2)}`
    : "—";
}

/**
 * "backtest vs production" difference text, e.g. `+$1.10 (+0.74%)` or `+2`.
 * Percentage is relative to production and omitted when production is zero.
 */
function diffLabel(production?: number, backtest?: number, money = false) {
  if (
    typeof production !== "number" ||
    !Number.isFinite(production) ||
    typeof backtest !== "number" ||
    !Number.isFinite(backtest)
  ) {
    return "—";
  }
  const diff = backtest - production;
  const amount = money
    ? `${diff < 0 ? "-" : "+"}$${Math.abs(diff).toFixed(2)}`
    : `${diff > 0 ? "+" : ""}${diff}`;
  const pct =
    production !== 0
      ? ` (${((diff / Math.abs(production)) * 100).toFixed(2)}%)`
      : "";
  return `${amount}${pct}`;
}

function countInWindow(
  points: VolatilityPoint[] | undefined,
  startTime: number,
  endTime: number,
) {
  return (points ?? []).filter((p) => p.t >= startTime && p.t <= endTime)
    .length;
}

/** Builds the categorized metric comparison shown above the two result columns. */
function build(result: PrecisionCheckerRunResult): PrecisionCheckerMetrics {
  const { startTime, endTime } = result.testCase;
  const accountName = new Map(
    result.accounts.map((account) => [account.slug, account.name]),
  );

  const backtestEndTotal = (slug: string) => {
    const snapshots = result.backtestBalanceSnapshots[slug];
    return snapshots && snapshots.length > 0
      ? snapshots[snapshots.length - 1].total
      : undefined;
  };

  const balanceSlugs = [
    ...new Set([
      ...Object.keys(result.initialBalance),
      ...Object.keys(result.productionEndBalance),
      ...Object.keys(result.backtestBalanceSnapshots),
    ]),
  ].sort();

  const vPointSymbols = [
    ...new Set([
      ...Object.keys(result.productionVPointsMap),
      ...Object.keys(result.backtestVPointsMap),
    ]),
  ].sort();

  const balanceRows: PrecisionCheckerMetricRow[] = balanceSlugs.map((slug) => {
    const prodTotal = result.productionEndBalance[slug]?.total;
    const btTotal = backtestEndTotal(slug);
    const pctDiff =
      prodTotal != null && btTotal != null && prodTotal !== 0
        ? (Math.abs(btTotal - prodTotal) / Math.abs(prodTotal)) * 100
        : null;
    return {
      key: `balance-${slug}`,
      metric: `Balance · ${accountName.get(slug)?.trim() || slug}`,
      initial: formatUsdt(result.initialBalance[slug]?.total),
      production: formatUsdt(prodTotal),
      backtest: formatUsdt(btTotal),
      diff: diffLabel(prodTotal, btTotal, true),
      severity: severityOf(pctDiff, BANDS.balancePct),
    };
  });

  const tradeCountRow: PrecisionCheckerMetricRow = {
    key: "trade-count",
    metric: "Trade history",
    initial: "—",
    production: `${result.productionHistory.length}`,
    backtest: `${result.backtestHistory.length}`,
    diff: diffLabel(
      result.productionHistory.length,
      result.backtestHistory.length,
    ),
    severity: severityOf(
      result.backtestHistory.length - result.productionHistory.length,
      BANDS.count,
    ),
  };

  const trades = pairTrades(
    result.productionHistory,
    result.backtestHistory,
  );

  const tradePairRows: PrecisionCheckerMetricRow[] = [
    {
      key: "trade-pairs",
      metric: "Trade pairs",
      initial: "—",
      production: `${trades.pairCount}/${trades.prodTotal}`,
      backtest: `${trades.pairCount}/${trades.btTotal}`,
      diff: `${trades.unpaired} unpaired`,
      severity: severityOf(trades.unpaired, BANDS.unpaired),
    },
    {
      key: "trade-entry-diff",
      metric: "Trade entry diff",
      initial: "—",
      production: "—",
      backtest: "—",
      diff:
        trades.meanEntryMinuteDiff != null
          ? `${trades.meanEntryMinuteDiff.toFixed(2)} min/pair`
          : "—",
      severity: severityOf(trades.meanEntryMinuteDiff, BANDS.minutes),
    },
    {
      key: "trade-exit-diff",
      metric: "Trade exit diff",
      initial: "—",
      production: "—",
      backtest: "—",
      diff:
        trades.meanExitMinuteDiff != null
          ? `${trades.meanExitMinuteDiff.toFixed(2)} min/pair`
          : "—",
      severity: severityOf(trades.meanExitMinuteDiff, BANDS.minutes),
    },
    {
      key: "trade-entry-price-diff",
      metric: "Entry price diff",
      initial: "—",
      production: "—",
      backtest: "—",
      diff:
        trades.meanEntryPricePctDiff != null
          ? `${trades.meanEntryPricePctDiff.toFixed(2)} pct/pair`
          : "—",
      severity: severityOf(trades.meanEntryPricePctDiff, BANDS.pricePct),
    },
    {
      key: "trade-exit-price-diff",
      metric: "Exit price diff",
      initial: "—",
      production: "—",
      backtest: "—",
      diff:
        trades.meanExitPricePctDiff != null
          ? `${trades.meanExitPricePctDiff.toFixed(2)} pct/pair`
          : "—",
      severity: severityOf(trades.meanExitPricePctDiff, BANDS.pricePct),
    },
    {
      key: "trade-averaging-minute-diff",
      metric: "Averaging minute diff",
      initial: "—",
      production: "—",
      backtest: "—",
      diff:
        trades.meanAveragingMinuteDiff != null
          ? `${trades.meanAveragingMinuteDiff.toFixed(2)} min/pair`
          : "—",
      severity: severityOf(trades.meanAveragingMinuteDiff, BANDS.minutes),
    },
    {
      key: "trade-averaging-diff",
      metric: "Averaging count diff",
      initial: "—",
      production: "—",
      backtest: "—",
      diff:
        trades.meanAveragingCountDiff != null
          ? `${trades.meanAveragingCountDiff.toFixed(2)} /pair`
          : "—",
      severity: severityOf(trades.meanAveragingCountDiff, BANDS.averagingCount),
    },
    {
      key: "trade-exit-reason-diff",
      metric: "Exit reason diff",
      initial: "—",
      production: "—",
      backtest: "—",
      diff:
        trades.pairCount > 0
          ? `${trades.exitReasonMismatches}/${trades.pairCount} pairs`
          : "—",
      severity:
        trades.pairCount > 0
          ? severityOf(
              (trades.exitReasonMismatches / trades.pairCount) * 100,
              BANDS.mismatchPct,
            )
          : "none",
    },
    {
      key: "trade-pnl-usdt-diff",
      metric: "PnL diff USDT",
      initial: "—",
      production: "—",
      backtest: "—",
      diff:
        trades.meanPnlUsdtDiff != null
          ? `$${trades.meanPnlUsdtDiff.toFixed(2)} /pair`
          : "—",
      severity: severityOf(trades.meanPnlUsdtDiff, BANDS.pnlUsdt),
    },
    {
      key: "trade-pnl-pct-diff",
      metric: "PnL diff %",
      initial: "—",
      production: "—",
      backtest: "—",
      diff:
        trades.meanPnlPctDiff != null
          ? `${trades.meanPnlPctDiff.toFixed(2)} pct/pair`
          : "—",
      severity: severityOf(trades.meanPnlPctDiff, BANDS.pnlPct),
    },
  ];

  const vPointRows: PrecisionCheckerMetricRow[] = vPointSymbols
    .map((symbol) => {
      const production = countInWindow(
        result.productionVPointsMap[symbol],
        startTime,
        endTime,
      );
      const backtest = countInWindow(
        result.backtestVPointsMap[symbol],
        startTime,
        endTime,
      );
      return {
        key: `vpoints-${symbol}`,
        metric: `vPoints · ${symbol}`,
        initial: "—",
        production: `${production}`,
        backtest: `${backtest}`,
        diff: diffLabel(production, backtest),
        severity: severityOf(backtest - production, BANDS.count),
      };
    })
    .filter((row) => row.production !== "0" || row.backtest !== "0");

  const pairing = pairVPoints(
    result.productionVPointsMap,
    result.backtestVPointsMap,
    startTime,
    endTime,
  );

  const pairRows: PrecisionCheckerMetricRow[] = [
    {
      key: "vpoint-pairs",
      metric: "vPoint pairs",
      initial: "—",
      production: `${pairing.prodPaired}/${pairing.prodTotal}`,
      backtest: `${pairing.btPaired}/${pairing.btTotal}`,
      diff: `${pairing.unpaired} unpaired`,
      severity: severityOf(pairing.unpaired, BANDS.unpaired),
    },
    {
      key: "vpoint-minute-diff",
      metric: "vPoint minute diff",
      initial: "—",
      production: "—",
      backtest: "—",
      diff:
        pairing.meanMinuteDiff != null
          ? `${pairing.meanMinuteDiff.toFixed(2)} min/pair`
          : "—",
      severity: severityOf(pairing.meanMinuteDiff, BANDS.minutes),
    },
  ];

  const categories = [
    toCategory("balance", "Balance", balanceRows),
    toCategory("trades", "Trades", [tradeCountRow, ...tradePairRows]),
    toCategory("vpoints", "Volatility points", [...vPointRows, ...pairRows]),
  ];

  const scoredCategories = categories
    .map((category) => category.score)
    .filter((score): score is number => score != null);
  const overallScore =
    scoredCategories.length === 0
      ? null
      : Math.round(
          scoredCategories.reduce((a, b) => a + b, 0) /
            scoredCategories.length,
        );

  return {
    overall: {
      score: overallScore,
      severity: scoreSeverity(overallScore),
    },
    categories,
  };
}

const metrics = {
  build,
} as const;

export default metrics;
