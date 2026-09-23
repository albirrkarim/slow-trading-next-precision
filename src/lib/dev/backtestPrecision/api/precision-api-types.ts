import type {
  BacktestTestCase,
  PrecisionRuntimeSnapshot,
} from "@/lib/system/runtime";

export type {
  BacktestTestCase,
  PrecisionRuntimeSnapshot,
} from "@/lib/system/runtime";

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
