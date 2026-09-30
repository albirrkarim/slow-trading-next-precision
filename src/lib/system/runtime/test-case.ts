import type { BalanceSummary, Position } from "../trading";
import type { BlackSwanState } from "../trading/black-swan";
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

  /** Closed-trade net USDT PnL accumulated on `dailyPnlDay` (UTC key). */
  dailyPnlUsdt?: number;
  /** UTC day key (`YYYY-MM-DD`) `dailyPnlUsdt` belongs to. */
  dailyPnlDay?: string;
  /** Black Swan protective flag captured so replays veto like production. */
  blackSwanProtective?: boolean;
  /**
   * Full captured Black Swan detector output — richer starting status for
   * replays (status, reason, cooldown bookkeeping); the flag above stays
   * the compatibility fallback for older captures.
   */
  blackSwanStatus?: BlackSwanState;
}

/**
 * Basic things that we can do backtest
 */
export interface BacktestTestCase {
  startTime?: number;
  endTime?: number;
  config: RuntimeConfig;
}
