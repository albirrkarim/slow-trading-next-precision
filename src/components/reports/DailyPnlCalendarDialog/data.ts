import type { Position } from "@/lib/system/trading";
import runtimeDailyPerformance from "@/lib/system/trading/daily-performance";

import type {
  DailyCalendarCell,
  DailyPnlCalendarBalanceSnapshot,
  DailyPnlCalendarTrade,
  MonthProjection,
  MonthSection,
} from "./types";
import {
  formatMonthTitle,
  getDaysInUtcMonth,
  isFiniteNumber,
  parseUtcDayKey,
  toUtcDayKey,
} from "./utils";

/** Adapts canonical persisted position data to the calendar's compact input. */
export function toDailyPnlCalendarTrade(
  position: Pick<Position, "opened" | "closed" | "pnl">,
): DailyPnlCalendarTrade {
  return {
    entryTime: position.opened.t,
    exitTime: position.closed?.t,
    netPnlPct: position.pnl.netPct,
    netProfitUSDT: position.pnl.netUsdt,
  };
}

/**
 * Reconstructs one running balance snapshot per UTC day from closed-trade PnL.
 */
export function buildTradePnlBalanceSnapshots({
  history,
  startingBalanceUSDT,
}: {
  history: DailyPnlCalendarTrade[];
  startingBalanceUSDT: number;
}): DailyPnlCalendarBalanceSnapshot[] {
  const closedTrades = history
    .map((trade) => ({
      closedAt: trade.exitTime ?? trade.entryTime,
      pnlUsdt:
        typeof trade.netProfitUSDT === "number" &&
        Number.isFinite(trade.netProfitUSDT)
          ? trade.netProfitUSDT
          : 0,
    }))
    .filter(
      (trade): trade is { closedAt: number; pnlUsdt: number } =>
        Number.isFinite(trade.closedAt) && trade.closedAt > 0,
    )
    .sort((left, right) => left.closedAt - right.closedAt);

  if (closedTrades.length === 0) {
    return [];
  }

  const dailyPnl = new Map<string, number>();
  for (const trade of closedTrades) {
    const day = toUtcDayKey(trade.closedAt);
    dailyPnl.set(day, (dailyPnl.get(day) ?? 0) + trade.pnlUsdt);
  }

  const firstDay = parseUtcDayKey(toUtcDayKey(closedTrades[0].closedAt));
  const lastDay = parseUtcDayKey(
    toUtcDayKey(closedTrades[closedTrades.length - 1].closedAt),
  );
  const snapshots: DailyPnlCalendarBalanceSnapshot[] = [];
  let balance = Number.isFinite(startingBalanceUSDT)
    ? startingBalanceUSDT
    : 0;

  for (
    const cursor = new Date(firstDay);
    cursor.getTime() <= lastDay.getTime();
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    const day = cursor.toISOString().slice(0, 10);
    balance += dailyPnl.get(day) ?? 0;
    snapshots.push({
      day,
      timestamp: cursor.getTime(),
      total: balance,
    });
  }

  return snapshots;
}

// BOTH:MONTHLY_TRADE_SHARPE
/** Calculates unannualized Sharpe from daily closed-trade return percentages. */
export function calculateMonthlyTradeSharpe(
  dailyTradeReturns: number[],
): number | null {
  const returns = dailyTradeReturns.filter(Number.isFinite);
  if (returns.length < 2) {
    return null;
  }

  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance =
    returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    returns.length;
  const standardDeviation = Math.sqrt(variance);

  return standardDeviation > 0 ? mean / standardDeviation : null;
}

export function buildMonthProjection(month: MonthSection): MonthProjection | null {
  const cells = month.cells.filter((cell): cell is DailyCalendarCell => Boolean(cell));
  const observedDays = Math.max(
    0,
    ...cells.map((cell) => cell.dayOfMonth),
  );
  const daysInMonth = getDaysInUtcMonth(month.monthKey);

  if (observedDays <= 0 || daysInMonth <= 0) {
    return null;
  }

  const observedTradePnlUsdt = cells.reduce(
    (sum, cell) => sum + cell.tradePnlUsdt,
    0,
  );
  const observedTrades = cells.reduce((sum, cell) => sum + cell.trades, 0);
  const averageTradePnlPerDay = observedTradePnlUsdt / observedDays;
  const estimatedMonthTradePnlUsdt = averageTradePnlPerDay * daysInMonth;
  const startBalance =
    cells.find((cell) => isFiniteNumber(cell.startBalance))?.startBalance ??
    null;
  const estimatedMonthTradePnlPercentOfStart =
    startBalance !== null && Math.abs(startBalance) > 0.000001
      ? (estimatedMonthTradePnlUsdt / startBalance) * 100
      : null;
  const estimatedEndBalance =
    startBalance !== null ? startBalance + estimatedMonthTradePnlUsdt : null;

  return {
    averageTradePnlPerDay,
    daysInMonth,
    estimatedEndBalance,
    estimatedMonthTradePnlUsdt,
    estimatedMonthTradePnlPercentOfStart,
    observedDays,
    observedTradePnlUsdt,
    observedTrades,
    tradePerDay: observedTrades / observedDays,
    startBalance,
  };
}

export function buildDailyCalendarData(
  history: DailyPnlCalendarTrade[],
  balanceSnapshots: DailyPnlCalendarBalanceSnapshot[],
  startingBalanceUSDT?: number,
): {
  months: MonthSection[];
  totalPnlUsdt: number;
  totalBalancePnlUsdt: number | null;
  totalTrades: number;
  bestDay: DailyCalendarCell | null;
  worstDay: DailyCalendarCell | null;
} {
  const tradeMap =
    runtimeDailyPerformance.trades.summarizeByUtcDay(history);

  const snapshotMap = new Map(balanceSnapshots.map((snapshot) => [snapshot.day, snapshot]));
  const allKeys = [...new Set([...tradeMap.keys(), ...snapshotMap.keys()])].sort();

  if (allKeys.length === 0) {
    return {
      months: [],
      totalPnlUsdt: 0,
      totalBalancePnlUsdt: null,
      totalTrades: 0,
      bestDay: null,
      worstDay: null,
    };
  }

  const firstDay = parseUtcDayKey(allKeys[0]);
  const lastDay = parseUtcDayKey(allKeys[allKeys.length - 1]);
  const cellsByDay = new Map<string, DailyCalendarCell>();
  let runningEndBalance: number | null = isFiniteNumber(startingBalanceUSDT)
    ? startingBalanceUSDT
    : null;
  const finalDay = new Date(
    Date.UTC(lastDay.getUTCFullYear(), lastDay.getUTCMonth(), lastDay.getUTCDate()),
  );

  for (
    const cursor = new Date(Date.UTC(firstDay.getUTCFullYear(), firstDay.getUTCMonth(), 1));
    cursor.getTime() <= finalDay.getTime();
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    const day = cursor.toISOString().slice(0, 10);
    const trade = tradeMap.get(day);
    const snapshot = snapshotMap.get(day);
    const tradePnlUsdt = trade?.pnlUsdt ?? 0;
    const tradePnlPercent = trade?.pnlPercent ?? 0;
    const trades = trade?.trades ?? 0;
    const wins = trade?.wins ?? 0;
    const winRate = trades > 0 ? (wins / trades) * 100 : 0;
    const snapshotTotal =
      typeof snapshot?.total === "number" && Number.isFinite(snapshot.total)
        ? snapshot.total
        : null;

    const startBalance: number | null =
      runningEndBalance !== null
        ? runningEndBalance
        : snapshotTotal !== null
          ? snapshotTotal
          : null;
    const balancePnlUsdt =
      snapshotTotal !== null && startBalance !== null
        ? snapshotTotal - startBalance
        : null;
    const endBalance: number | null =
      snapshotTotal !== null ? snapshotTotal : null;
    const balancePnlPercentOfStart =
      startBalance !== null &&
      balancePnlUsdt !== null &&
      Math.abs(startBalance) > 0.000001
        ? (balancePnlUsdt / startBalance) * 100
        : null;

    if (endBalance !== null) {
      runningEndBalance = endBalance;
    }

    cellsByDay.set(day, {
      day,
      dayOfMonth: cursor.getUTCDate(),
      tradePnlUsdt,
      tradePnlPercent,
      balancePnlUsdt,
      balancePnlPercentOfStart,
      startBalance,
      endBalance,
      trades,
      wins,
      winRate,
      monthlyPnlShare: 0,
    });
  }

  const monthSections: MonthSection[] = [];
  const monthCursor = new Date(
    Date.UTC(firstDay.getUTCFullYear(), firstDay.getUTCMonth(), 1),
  );
  const lastMonthCursor = new Date(
    Date.UTC(lastDay.getUTCFullYear(), lastDay.getUTCMonth(), 1),
  );

  while (monthCursor.getTime() <= lastMonthCursor.getTime()) {
    const year = monthCursor.getUTCFullYear();
    const month = monthCursor.getUTCMonth();
    const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;
    const firstOfMonth = new Date(Date.UTC(year, month, 1));
    const lastOfMonth = new Date(Date.UTC(year, month + 1, 0));
    const monthCells: DailyCalendarCell[] = [];

    for (let day = 1; day <= lastOfMonth.getUTCDate(); day += 1) {
      const dayKey = new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
      const cell = cellsByDay.get(dayKey);

      if (cell) {
        monthCells.push(cell);
      }
    }

    const monthlyProfitUsdt = monthCells.reduce(
      (sum, cell) => sum + Math.max(0, cell.tradePnlUsdt),
      0,
    );
    const monthlyLossUsdt = monthCells.reduce(
      (sum, cell) => sum + Math.abs(Math.min(0, cell.tradePnlUsdt)),
      0,
    );
    const cells: Array<DailyCalendarCell | null> = [];

    for (let i = 0; i < firstOfMonth.getUTCDay(); i += 1) {
      cells.push(null);
    }

    for (let day = 1; day <= lastOfMonth.getUTCDate(); day += 1) {
      const dayKey = new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
      const cell = cellsByDay.get(dayKey);

      if (!cell) {
        cells.push(null);
        continue;
      }

      const monthlyPnlTotal =
        cell.tradePnlUsdt > 0 ? monthlyProfitUsdt : monthlyLossUsdt;
      cells.push({
        ...cell,
        monthlyPnlShare:
          monthlyPnlTotal > 0
            ? Math.abs(cell.tradePnlUsdt) / monthlyPnlTotal
            : 0,
      });
    }

    while (cells.length % 7 !== 0) {
      cells.push(null);
    }

    monthSections.push({
      monthKey,
      title: formatMonthTitle(firstOfMonth.toISOString().slice(0, 10)),
      cells,
      tradeSharpe: calculateMonthlyTradeSharpe(
        monthCells.map((cell) => cell.tradePnlPercent),
      ),
    });

    monthCursor.setUTCMonth(monthCursor.getUTCMonth() + 1);
  }

  monthSections.reverse();

  const populatedCells = [...cellsByDay.values()].filter((cell) => cell.trades > 0);
  const latestEndingCellWithBalance = [...cellsByDay.values()]
    .reverse()
    .find((cell) => isFiniteNumber(cell.endBalance));
  const totalPnlUsdt = populatedCells.reduce(
    (sum, cell) => sum + cell.tradePnlUsdt,
    0,
  );
  const totalBalancePnlUsdt =
    latestEndingCellWithBalance && isFiniteNumber(startingBalanceUSDT)
      ? latestEndingCellWithBalance.endBalance! - startingBalanceUSDT
      : null;
  const totalTrades = populatedCells.reduce((sum, cell) => sum + cell.trades, 0);
  const bestDay = populatedCells.reduce<DailyCalendarCell | null>(
    (best, cell) => (!best || cell.tradePnlUsdt > best.tradePnlUsdt ? cell : best),
    null,
  );
  const worstDay = populatedCells.reduce<DailyCalendarCell | null>(
    (worst, cell) =>
      !worst || cell.tradePnlUsdt < worst.tradePnlUsdt ? cell : worst,
    null,
  );

  return {
    months: monthSections,
    totalPnlUsdt,
    totalBalancePnlUsdt,
    totalTrades,
    bestDay,
    worstDay,
  };
}
