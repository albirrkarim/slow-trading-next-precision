import type { RuntimeEngineState } from "@/lib/precision/types";
import type { SlowTradingSettingsConfig } from "@/lib/slowTrading";

/**
 * Exact production runtime snapshot used to replay or compare a precision
 * test case. Captures the engine state at one point in time: at recording
 * start it is the replay input, at recording end it is the comparison
 * target.
 */
export interface PrecisionRuntimeSnapshot {
  balance: RuntimeEngineState["balance"];
  openPositions: RuntimeEngineState["openPositions"];
  vPointsMap: RuntimeEngineState["vPointsMap"];
}

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
  /**
   * Captured production starting state for precision-checker replays. Normal
   * backtests leave it undefined.
   */
  initialState?: PrecisionRuntimeSnapshot;
}
