import type {
  SlowTradingModeState,
  SlowTradingStorageData,
} from "@/lib/runtime/types";
import type { PredictionEngineMemory } from "@/lib/dynamic";
import type { Position } from "@/lib/trading/models";

/** Runtime modes supported by the V1 precision run contract. */
export type PrecisionRuntimeMode = "live" | "sandbox" | "backtest";

/** Strategies supported by the V1 precision run contract. */
export type PrecisionStrategyId = "multi" | "hedge" | "streak";

/** Legacy Hedge/Streak role normalized into the comparison key. */
export type PrecisionPositionRole = "MAIN" | "COUNTER";

/** Canonical position shared by production test cases and backtest results. */
export type PrecisionPositionV1 = Position & {
  strategyId: PrecisionStrategyId;
  role?: PrecisionPositionRole;
};

/** Effective runtime and trading configuration captured for one run. */
export interface PrecisionRunConfigV1 {
  runtime: SlowTradingStorageData["runtime"];
  trading: SlowTradingStorageData["config"];
}

/**
 * Shared public volatility memory per symbol at run start. This is the
 * vPoint-detection starting state a backtest must reproduce.
 */
export type PrecisionSharedVolatilityV1 = Record<
  string,
  PredictionEngineMemory
>;

/** Measurable usage recorded with a precision run. */
export interface PrecisionRunMetricsV1 {
  wallDurationMs: number;
  logicalDurationMs: number;
  apiCalls: Record<string, { count: number; totalMs: number; errors: number }>;
  stages: Record<string, { count: number; totalMs: number; errors: number }>;
  fills: number;
  errors: number;
  retries: number;
  rateLimitUsage: number;
}

/** Final state of one precision-measured run. */
export interface PrecisionRunV1 {
  schema: 1;
  strategy: PrecisionStrategyId;
  mode: PrecisionRuntimeMode;
  account: string;
  startTime: number;
  endTime: number;
  config: PrecisionRunConfigV1;
  initialState: SlowTradingModeState;
  sharedVolatility: PrecisionSharedVolatilityV1;
  endPositions: PrecisionPositionV1[];
  metrics?: PrecisionRunMetricsV1;
}

/** Recorded production or sandbox run captured for precision comparison. */
export type ProdTestCaseV1 = PrecisionRunV1 & {
  mode: "live" | "sandbox";
};

/** Backtest run persisted in the same canonical shape as production. */
export type PrecisionBacktestResultV1 = PrecisionRunV1 & {
  mode: "backtest";
};

/** Metadata for one persisted backtest result. */
export interface PrecisionBacktestResultSummary {
  fileName: string;
  strategy: PrecisionStrategyId;
  startTime: number;
  endTime: number;
  positionCount: number;
}
