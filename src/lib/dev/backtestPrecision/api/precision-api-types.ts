import type {
  BacktestTestCase,
  PrecisionRuntimeSnapshot,
} from "@/lib/system/runtime";
import type {
  BacktestRunCounts,
  BacktestRunSummary,
} from "../backtest/backtest-precision-types";
import type { ExchangeType } from "@/lib/system/types";

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
 * POST /api/dev/backtest-precision response body. Runs stream their artifact
 * arrays (positions, vPoints, balance snapshots) into chunked part files
 * under `cachePath`, so the body carries only aggregates and cache metadata;
 * the UI loads each field lazily through /api/dev/backtest-precision/detail.
 */
export interface BacktestPrecisionResponse {
  exchangeType: ExchangeType;
  counts: BacktestRunCounts;
  summary: BacktestRunSummary;
  /** True when the body was served from the saved result cache. */
  cached?: boolean;
  /**
   * Effective dataset window actually simulated, after intersecting every
   * symbol's data availability. Trading starts ~VPOINT_WARMUP_MS after
   * `dataset.startTime`; absent on legacy cache entries.
   */
  dataset?: { endTime: number; startTime: number };
  /** Stable key identifying the run's artifact directory. */
  cacheKey?: string;
  /** Absolute path of the cache directory holding this result's artifacts. */
  cachePath?: string;
}
