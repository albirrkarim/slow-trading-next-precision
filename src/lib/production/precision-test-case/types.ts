import type { Position } from "@/lib/trading/models";
import type {
  BacktestPrecisionInitialState,
  BacktestTestCase,
} from "@/lib/dev/backtestPrecision/api/precision-api-types";

/** A production recording that can later be supplied to the precision checker. */
export interface PrecisionTestCase extends BacktestTestCase {
  /** Exact runtime snapshot taken when the recording started. */
  initialState: BacktestPrecisionInitialState;
  tradeHistory: Position[];
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

/** Metadata of one completed precision test-case file stored on disk. */
export interface PrecisionTestCaseFileSummary {
  fileName: string;
  mode: PrecisionTestCaseMode;
  startTime: number;
  endTime: number;
  tradeHistoryLength: number;
  sizeBytes: number;
}
