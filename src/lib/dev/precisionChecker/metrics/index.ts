import type { VolatilityPoint } from "@/lib/system/types";

import pairVPoints from "./pairs";
import pairTrades from "./trade-pairs";
import type { PrecisionCheckerRunResult } from "../types";

/** One rendered production↔backtest comparison row. */
export interface PrecisionCheckerMetricRow {
  key: string;
  metric: string;
  initial: string;
  production: string;
  backtest: string;
  diff: string;
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

/** Builds the metric comparison rows shown above the two result columns. */
function build(result: PrecisionCheckerRunResult): PrecisionCheckerMetricRow[] {
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

  const balanceRows = balanceSlugs.map((slug) => ({
    key: `balance-${slug}`,
    metric: `Balance · ${accountName.get(slug)?.trim() || slug}`,
    initial: formatUsdt(result.initialBalance[slug]?.total),
    production: formatUsdt(result.productionEndBalance[slug]?.total),
    backtest: formatUsdt(backtestEndTotal(slug)),
    diff: diffLabel(
      result.productionEndBalance[slug]?.total,
      backtestEndTotal(slug),
      true,
    ),
  }));

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
    },
  ];

  const vPointRows = vPointSymbols
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
    },
  ];

  return [
    ...balanceRows,
    tradeCountRow,
    ...tradePairRows,
    ...vPointRows,
    ...pairRows,
  ];
}

const metrics = {
  build,
} as const;

export default metrics;
