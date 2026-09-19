import { SlowTradingSettingsConfig } from "@/lib/slowTrading";

export interface BacktestPrecisionParams {
  // BTEST:BACKTEST_MANAGEMENT_SYMBOLS
  range: string;
  startTime?: number;
  endTime?: number;
  upToDateKlines: boolean;
  upToDateDecisionBacktest: boolean;
  config: SlowTradingSettingsConfig;
  verbose?: boolean;
}
