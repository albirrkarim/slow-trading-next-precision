import type { BalanceSummary, Position } from "../trading";
import type { VolatilityPoint } from "../types/market";
import type { RuntimeConfig } from "./types";

/**
 * Exact production runtime snapshot used to replay or compare a precision
 * test case. Captures the engine state at one point in time: at recording
 * start it is the replay input, at recording end it is the comparison
 * target.
 */
export interface PrecisionRuntimeSnapshot {
  balance: Record<string, BalanceSummary>;
  openPositions: Position[];
  vPointsMap: Record<string, VolatilityPoint[]>;
  /**
   * Free-form strategy-owned records captured with the snapshot so replays
   * reproduce them (e.g. streak pending re-entries). Engine never reads it.
   */
  strategy?: unknown;
}

/**
 * Basic things that we can do backtest
 */
export interface BacktestTestCase {
  startTime?: number;
  endTime?: number;
  config: RuntimeConfig;
}
