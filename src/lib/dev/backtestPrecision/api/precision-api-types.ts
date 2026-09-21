import type { SlowTradingSettingsConfig } from "@/lib/slowTrading";

/**
 * Basic things that we can do backtest
 */
export interface BacktestTestCase {
  startTime?: number;
  endTime?: number;
  config: SlowTradingSettingsConfig;
}

export interface BacktestPrecisionParams extends BacktestTestCase {
  // BTEST:BACKTEST_MANAGEMENT_SYMBOLS

  // Used in backtest /dev/backtest
  range: string;
  upToDateKlines: boolean;
  upToDateDecisionBacktest: boolean;
  verbose?: boolean;
}
