"use client";

import { Box, Tooltip, Typography } from "@mui/material";
import type { ReactNode } from "react";

import type {
  DailyCalendarCell,
  MonthProjection,
  MonthSection,
} from "./types";
import {
  formatSharpe,
  formatSignedPercent,
  formatSignedUsdt,
  formatUsdt,
  formatWinRate,
} from "./utils";

function metricTooltip(title: string, lines: string[]) {
  return (
    <Box>
      <Typography component="div" sx={{ fontSize: "0.8rem", fontWeight: 700 }}>
        {title}
      </Typography>
      {lines.map((line) => (
        <Typography key={line} component="div" sx={{ fontSize: "0.75rem" }}>
          {line}
        </Typography>
      ))}
    </Box>
  );
}

export function buildMetricTooltips(cell: DailyCalendarCell) {
  const tradeValue =
    cell.trades > 0 ? formatSignedUsdt(cell.tradePnlUsdt) : "$0.00";
  const balanceValue =
    cell.balancePnlUsdt !== null ? formatSignedUsdt(cell.balancePnlUsdt) : "—";
  const startValue = formatUsdt(cell.startBalance);
  const endValue = formatUsdt(cell.endBalance);
  const balanceFormula =
    cell.balancePnlUsdt !== null &&
    cell.startBalance !== null &&
    cell.endBalance !== null
      ? `${balanceValue} = ${endValue} - ${startValue}`
      : "Needs both a start balance and an end balance snapshot.";
  const balancePnlFormula =
    cell.balancePnlPercentOfStart !== null &&
    cell.balancePnlUsdt !== null &&
    cell.startBalance !== null
      ? `${formatSignedPercent(cell.balancePnlPercentOfStart)} = (${balanceValue} / ${startValue}) * 100`
      : "Needs Balance Δ and a non-zero start balance.";

  return {
    trade: metricTooltip("Trade PnL", [
      `Sum of netProfitUSDT from closed trades on ${cell.day}.`,
      `Closed trade count: ${cell.trades}.`,
      `Result: ${tradeValue}.`,
    ]),
    tradePnlPercent: metricTooltip("Trade PnL %", [
      `Sum of position.pnl.netPct from closed trades on ${cell.day}.`,
      `Result: ${formatSignedPercent(cell.tradePnlPercent)}.`,
    ]),
    winRate: metricTooltip("Win rate", [
      "A win is a closed trade with positive net PnL.",
      "Formula: wins / closed trades * 100.",
      `Result: ${cell.wins} / ${cell.trades} = ${formatWinRate(cell.winRate)}.`,
    ]),
    balance: metricTooltip("Balance Δ", [
      "Calculated from balance_snapshots.json.",
      "Formula: end balance - start balance.",
      balanceFormula,
    ]),
    balancePnl: metricTooltip("Balance PnL %", [
      "Calculated from Balance Δ and start balance.",
      "Formula: (Balance Δ / Start) * 100.",
      balancePnlFormula,
    ]),
    trades: metricTooltip("Trades", [
      "Count of closed trade history records for this UTC day.",
      "A trade is grouped by exitTime, falling back to entryTime.",
      `Result: ${cell.trades} trade${cell.trades === 1 ? "" : "s"}.`,
    ]),
    start: metricTooltip("Start Balance", [
      "Start is the previous running end balance.",
      "The first available day uses startingBalanceUSDT when provided.",
      `Result: ${startValue}.`,
    ]),
    end: metricTooltip("End Balance", [
      "End is the day's total from balance_snapshots.json.",
      "Missing snapshot means no end balance for that day.",
      `Result: ${endValue}.`,
    ]),
  };
}

export function TooltipText(props: {
  children: ReactNode;
  title: ReactNode;
}) {
  const { children, title } = props;

  return (
    <Tooltip arrow placement="top" title={title}>
      <Box component="span" sx={{ cursor: "help" }}>
        {children}
      </Box>
    </Tooltip>
  );
}

export function TooltipChip(props: {
  children: ReactNode;
  title: ReactNode;
}) {
  const { children, title } = props;

  return (
    <Tooltip arrow placement="top" title={title}>
      <Box component="span" sx={{ display: "inline-flex", maxWidth: "100%" }}>
        {children}
      </Box>
    </Tooltip>
  );
}

export function buildHeaderTooltips(params: {
  bestDay: DailyCalendarCell | null;
  monthProjection: MonthProjection | null;
  selectedMonthTitle: string;
  totalBalancePnlUsdt: number | null;
  totalPnlUsdt: number;
  totalTrades: number;
  worstDay: DailyCalendarCell | null;
}) {
  const {
    bestDay,
    monthProjection,
    selectedMonthTitle,
    totalBalancePnlUsdt,
    totalPnlUsdt,
    totalTrades,
    worstDay,
  } = params;

  return {
    tradeTotal: metricTooltip("Trade Total", [
      "Sum of daily Trade PnL for days that have closed trades.",
      "Each day sums closed trade history netProfitUSDT.",
      `Result: ${formatSignedUsdt(totalPnlUsdt)}.`,
    ]),
    balanceTotal: metricTooltip("Balance Δ Total", [
      "Uses balance snapshots across the visible history range.",
      "Formula: latest ending balance - startingBalanceUSDT.",
      totalBalancePnlUsdt !== null
        ? `Result: ${formatSignedUsdt(totalBalancePnlUsdt)}.`
        : "Needs startingBalanceUSDT and at least one ending balance snapshot.",
    ]),
    trades: metricTooltip("Trades", [
      "Total closed trade history records in the calendar range.",
      "Each trade is grouped by exitTime, falling back to entryTime.",
      `Result: ${totalTrades} trade${totalTrades === 1 ? "" : "s"}.`,
    ]),
    bestDay: metricTooltip("Best Day", [
      "Day with the highest daily Trade PnL.",
      "Only days with at least one closed trade are considered.",
      bestDay
        ? `Result: ${bestDay.day} at ${formatSignedUsdt(bestDay.tradePnlUsdt)}.`
        : "No closed trade days available.",
    ]),
    worstDay: metricTooltip("Worst Day", [
      "Day with the lowest daily Trade PnL.",
      "Only days with at least one closed trade are considered.",
      worstDay
        ? `Result: ${worstDay.day} at ${formatSignedUsdt(worstDay.tradePnlUsdt)}.`
        : "No closed trade days available.",
    ]),
    avgProfitPerDay: metricTooltip("Avg Profit / Day", [
      `Calculated for ${selectedMonthTitle}.`,
      "Formula: observed month Trade PnL / observed calendar days.",
      monthProjection
        ? `${formatSignedUsdt(monthProjection.averageTradePnlPerDay)} = ${formatSignedUsdt(monthProjection.observedTradePnlUsdt)} / ${monthProjection.observedDays} days.`
        : "Needs at least one observed day in the selected month.",
      monthProjection
        ? `Trade pace: ${monthProjection.tradePerDay.toFixed(2)} trades/day from ${monthProjection.observedTrades} trades.`
        : "Trade pace needs observed trades.",
    ]),
    estimatedMonthProfit: metricTooltip("Estimated Month-End Profit", [
      `Projection for ${selectedMonthTitle}.`,
      "Formula: Avg Profit / Day * days in month.",
      monthProjection
        ? `${formatSignedUsdt(monthProjection.estimatedMonthTradePnlUsdt)} = ${formatSignedUsdt(monthProjection.averageTradePnlPerDay)} * ${monthProjection.daysInMonth} days.`
        : "Needs an average profit/day for the selected month.",
      monthProjection &&
        monthProjection.estimatedMonthTradePnlPercentOfStart !== null
        ? `Balance gain estimate: ${formatSignedPercent(monthProjection.estimatedMonthTradePnlPercentOfStart)} of ${formatUsdt(monthProjection.startBalance)} start balance.`
        : "Balance gain estimate needs a start balance.",
      monthProjection && monthProjection.estimatedEndBalance !== null
        ? `Estimated end balance: ${formatUsdt(monthProjection.estimatedEndBalance)} = ${formatUsdt(monthProjection.startBalance)} + ${formatSignedUsdt(monthProjection.estimatedMonthTradePnlUsdt)}.`
        : "Estimated end balance needs a start balance.",
    ]),
  };
}

export function buildMonthTradeSharpeTooltip(month: MonthSection) {
  const observedCells = month.cells.filter(
    (cell): cell is DailyCalendarCell => cell !== null,
  );

  return metricTooltip("Monthly Trade Sharpe", [
    "Uses only fee-aware closed-trade position.pnl.netPct values.",
    "Each UTC day is one observation; days without closed trades contribute 0%.",
    "Formula: mean daily trade return / population standard deviation.",
    "Risk-free rate: 0%. This value is not annualized.",
    `Observed days: ${observedCells.length}. Result: ${formatSharpe(month.tradeSharpe)}.`,
  ]);
}
