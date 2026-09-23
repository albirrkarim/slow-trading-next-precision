import type {
  BacktestTestCase,
  PrecisionRuntimeSnapshot,
} from "@/lib/system/runtime";
import type { BacktestPrecisionResult } from "../backtest/backtest-precision-types";

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

/**
 * POST /api/dev/backtest-precision response body. The result fields are the
 * same shape persisted under `cachePath`; the envelope adds cache metadata
 * for debugging. `cachePath` is omitted for precision-checker replays and
 * when persisting the result failed.
 */
export interface BacktestPrecisionResponse extends BacktestPrecisionResult {
  /** True when the body was served from the saved result cache. */
  cached?: boolean;
  /** Absolute path of the cache directory holding this result's artifacts. */
  cachePath?: string;
}
