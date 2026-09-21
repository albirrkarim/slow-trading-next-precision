import type { VolatilityPoint } from "@/lib/dynamic";
import type { Position } from "@/lib/trading/models";
import type { BacktestTestCase } from "@/lib/dev/backtestPrecision/api/precision-api-types";

/** A production recording that can later be supplied to the precision checker. */
export interface PrecisionTestCase extends BacktestTestCase {
  tradeHistory: Position[];
  /** Volatility points available when the recording started. */
  initialVPointsMap?: Record<string, VolatilityPoint[]>;
}

export type PrecisionTestCaseMode = "live" | "sandbox";

export interface PrecisionTestCaseStatus {
  recording: boolean;
  mode?: PrecisionTestCaseMode;
  startTime?: number;
  tradeHistoryLength: number;
  fileName?: string;
}

/** Durable marker describing the currently active production recording. */
export interface PrecisionTestCaseRecordingState {
  recording: boolean;
  mode?: PrecisionTestCaseMode;
  startTime?: number;
  fileName?: string;
}

export interface PrecisionTestCaseResult {
  fileName: string;
  path: string;
  testCase: PrecisionTestCase;
}
