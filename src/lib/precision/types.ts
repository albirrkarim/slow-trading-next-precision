import type {
  SlowTradingModeState,
  SlowTradingStorageData,
} from "@/lib/runtime/types";
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

/** Final state of one precision-measured run. */
export interface PrecisionRunV1 {
  schema: 1;
  strategy: PrecisionStrategyId;
  mode: PrecisionRuntimeMode;
  startTime: number;
  endTime: number;
  config: PrecisionRunConfigV1;
  initialState: SlowTradingModeState;
  endPositions: PrecisionPositionV1[];
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
