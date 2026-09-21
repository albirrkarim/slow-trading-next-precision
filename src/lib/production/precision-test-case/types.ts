import type {
  BacktestTestCase,
  PrecisionRuntimeSnapshot,
} from "@/lib/dev/backtestPrecision/api/precision-api-types";
import type { Position } from "@/lib/trading/models";

/** A production recording that can later be supplied to the precision checker. */
export interface PrecisionTestCase extends BacktestTestCase {
  /**
   * Runtime state captured when the recording ends; absent in the pending
   * file. Unlike `initialState`, `vPointsMap` here is a delta: per symbol,
   * the vPoints newly detected during the recording window plus pre-existing
   * points whose content changed while recording (e.g. `usedBy*` markers
   * gained through entry/averaging). Reconstruct the full map as
   * `initialState.vPointsMap` overlaid with this delta; symbols with no
   * delta are omitted.
   */
  endState?: PrecisionRuntimeSnapshot;
  /** Exact runtime snapshot taken when the recording started. */
  initialState: PrecisionRuntimeSnapshot;
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
