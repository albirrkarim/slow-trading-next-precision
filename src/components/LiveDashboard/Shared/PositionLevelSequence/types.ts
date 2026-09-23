import type { PositionLastMonitoringStage } from "@/lib/system/trading";

/**
 * Visual state of one level chip in a position's entry → averaging → exit
 * path.
 *
 * - `current`: the latest reached level for an open position.
 * - `exit`: the level the position closed at.
 * - `passed`: a level the position already moved through.
 * - `reserved`: a funded watch step still waiting to trigger.
 * - `skipped`: a reached adverse level that never averaged.
 * - `target`: the post-entry target vPoint that stopped averaging.
 * - `unreserved`: a watch step without funded reserve coverage.
 */
export type PositionLevelSequenceState =
  | "current"
  | "exit"
  | "passed"
  | "reserved"
  | "skipped"
  | "target"
  | "unreserved";

/** Persisted reserve-step status surfaced on a sequence chip. */
export type PositionLevelSequenceReserveStatus =
  "RELEASED" | "RESERVED" | "UNRESERVED" | "USED";

/** How much of an unreserved step's margin is covered by spendable balance. */
export type PositionLevelSequenceCoverage = "full" | "none" | "partial";

/**
 * One renderable level in a position's entry → averaging → exit path.
 *
 * History rows derive items from the persisted position JSON
 * (`strategy.averaging.executions`, `strategy.averaging.steps`, `vPoints`,
 * `opened`/`closed` vPoints). Open positions derive them from the live watch
 * state plus the current spendable balance for unreserved coverage.
 */
export interface PositionLevelSequenceItem {
  /**
   * Adaptive multiplier persisted on the averaging execution at this level.
   * Present only when the fill ran with adaptive averaging enabled; used to
   * label the tooltip without consulting current configuration.
   */
  adaptiveMultiplier?: number;
  /**
   * Actual allocation multiplier used by the averaging fill at this level
   * (`execution.allocationPct`, or the simulated multiplier for scenarios).
   */
  averagingMultiplier?: number;
  /** Spendable USDT currently covering an unreserved step's margin. */
  coveredMarginUsdt: number;
  /**
   * Profit-direction drift percentage from the reached level's vPoint price
   * to the current mark price. Only meaningful on the `current` level.
   */
  driftPct?: number;
  /** Monitoring stage frozen on the position when it exited at this level. */
  exitMonitoringState?: PositionLastMonitoringStage;
  /** Whether an averaging fill executed at this level. */
  isAveraged: boolean;
  /** Whether this chip is the position entry level. */
  isEntry: boolean;
  /** Whether the position closed at this level. */
  isExit?: boolean;
  /** Signed volatility level (negative = below anchor, positive = above). */
  level: number;
  /** Margin USDT reserved or spent at this level. */
  marginUsdt?: number;
  /** Monitoring stage frozen when the averaging fill at this level executed. */
  monitoringState?: PositionLastMonitoringStage;
  /** Reserve status of the watch step backing this level, when applicable. */
  reserveStatus?: PositionLevelSequenceReserveStatus;
  /** Visual state of this chip. */
  state: PositionLevelSequenceState;
  /** Coverage classification for `unreserved` chips. */
  unreservedCoverage?: PositionLevelSequenceCoverage;
}
