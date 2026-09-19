import { type ConfigDraft } from "@/components/LiveDashboard/Navbar/navbar-types";

export interface BacktestConfig {
  mode: "kline" | "volatility_point";

  // Data
  symbols: string[]; // multiple symbols selected
  range: string;
  // Optional override: when provided, these will be sent to server
  // and used instead of deriving from `range`.
  startTime?: number;
  endTime?: number;

  // Up to date
  upToDateKlines: boolean; // boolean: fetch fresh klines for selected symbols?
  upToDateDecisionBacktest: boolean;

  // Info
  name?: string;
  description?: string;

  // Starting point
  startingBalanceUSDT: number;

  // Config
  /** Grouped SLOW settings passed unchanged to the backtest backend. */
  settings?: ConfigDraft;
}
