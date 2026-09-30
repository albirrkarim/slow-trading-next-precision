export type DailyPnlCalendarTrade = {
  entryTime: number;
  exitTime?: number;
  netPnlPct?: number;
  netProfitUSDT?: number;
};

export type DailyPnlCalendarBalanceSnapshot = {
  day: string;
  timestamp: number;
  total: number;
};

export type DailyCalendarCell = {
  day: string;
  dayOfMonth: number;
  tradePnlUsdt: number;
  tradePnlPercent: number;
  balancePnlUsdt: number | null;
  balancePnlPercentOfStart: number | null;
  startBalance: number | null;
  endBalance: number | null;
  trades: number;
  wins: number;
  winRate: number;
  monthlyPnlShare: number;
};

export type MonthSection = {
  monthKey: string;
  title: string;
  cells: Array<DailyCalendarCell | null>;
  tradeSharpe: number | null;
};

export type MonthProjection = {
  averageTradePnlPerDay: number;
  daysInMonth: number;
  estimatedEndBalance: number | null;
  estimatedMonthTradePnlUsdt: number;
  estimatedMonthTradePnlPercentOfStart: number | null;
  observedDays: number;
  observedTradePnlUsdt: number;
  observedTrades: number;
  tradePerDay: number;
  startBalance: number | null;
};
