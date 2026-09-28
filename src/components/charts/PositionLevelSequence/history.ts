import type { Position } from "@/lib/system/trading";

import type { PositionLevelSequenceItem } from "./types";

/** Whether the close reason marks a post-entry volatility-target exit. */
function isTargetExitReason(position: Position): boolean {
  return (
    position.closed?.reason === "VOLATILITY_TARGET_TP" ||
    position.closed?.reason === "VOLATILITY_TARGET_SL"
  );
}

/**
 * Builds the persisted entry, averaging, and exit path for a closed trade.
 *
 * Everything derives from the position JSON — `opened.vPoint`, intermediate
 * `vPoints`, `strategy.averaging.executions`, and `closed.vPoint` — so the
 * rendered sequence reflects the data recorded when the trade happened, not
 * the current runtime configuration.
 *
 * When `position.vPoints` is present (BOTH:POSITION_VPOINT_PATH) the sequence
 * walks the recorded point path so reached-but-not-averaged levels surface as
 * `skipped`. Older positions without a recorded path fall back to listing
 * only the executed averaging levels.
 */
export function buildHistoryPositionLevelSequence(
  position: Position,
): PositionLevelSequenceItem[] {
  // BOTH:REUSABLE_LEVEL_SEQUENCE
  const entryLevel = Number(position.opened.vPoint.lvl);
  const executions = [...(position.strategy.averaging.executions ?? [])].sort(
    (left, right) => left.t - right.t,
  );

  if (position.vPoints !== undefined && Number.isFinite(entryLevel)) {
    // BOTH:POSITION_VPOINT_PATH
    const exitId = position.closed?.vPoint?.id;
    const intermediatePoints = position.vPoints.filter(
      (point) =>
        Number.isFinite(point.lvl) &&
        point.id !== position.opened.vPoint.id &&
        point.id !== exitId,
    );
    const executionByLevel = new Map(
      executions
        .filter((execution) => Number.isFinite(execution.level))
        .map((execution) => [execution.level, execution]),
    );
    const items: PositionLevelSequenceItem[] = [
      {
        coveredMarginUsdt: 0,
        isAveraged: false,
        isEntry: true,
        level: entryLevel,
        state: "passed",
      },
    ];

    for (const point of intermediatePoints) {
      const execution = executionByLevel.get(point.lvl);
      const isAveraged = execution !== undefined;
      const isAdverseLevel =
        position.direction === "LONG" ? point.lvl < 0 : point.lvl > 0;
      const isDeeperThanEntry = Math.abs(point.lvl) > Math.abs(entryLevel);

      items.push({
        adaptiveMultiplier: execution?.adaptiveMultiplier,
        averagingMultiplier: execution?.allocationPct,
        coveredMarginUsdt: 0,
        isAveraged,
        isEntry: false,
        level: point.lvl,
        marginUsdt: execution?.marginUsdt,
        monitoringState: execution?.monitoringState,
        reserveStatus: isAveraged ? "USED" : undefined,
        state:
          !isAveraged && isAdverseLevel && isDeeperThanEntry
            ? "skipped"
            : "passed",
      });
    }

    const exitLevel = Number(position.closed?.vPoint?.lvl);
    if (Number.isFinite(exitLevel)) {
      const execution = executionByLevel.get(exitLevel);
      items.push({
        adaptiveMultiplier: execution?.adaptiveMultiplier,
        averagingMultiplier: execution?.allocationPct,
        coveredMarginUsdt: 0,
        exitMonitoringState: position.lastMonitoringStage,
        isAveraged: execution !== undefined,
        isEntry: false,
        isExit: true,
        level: exitLevel,
        marginUsdt: execution?.marginUsdt,
        monitoringState: execution?.monitoringState,
        reserveStatus: execution ? "USED" : undefined,
        state: isTargetExitReason(position) ? "target" : "exit",
      });
    }

    return items;
  }

  const items: PositionLevelSequenceItem[] = Number.isFinite(entryLevel)
    ? [
        {
          coveredMarginUsdt: 0,
          isAveraged: false,
          isEntry: true,
          level: entryLevel,
          state: "passed",
        },
      ]
    : [];
  for (const execution of executions) {
    if (!Number.isFinite(execution.level)) {
      continue;
    }

    items.push({
      adaptiveMultiplier: execution.adaptiveMultiplier,
      averagingMultiplier: execution.allocationPct,
      coveredMarginUsdt: 0,
      isAveraged: true,
      isEntry: false,
      level: execution.level,
      marginUsdt: execution.marginUsdt,
      monitoringState: execution.monitoringState,
      reserveStatus: "USED",
      state: "passed",
    });
  }

  const exitLevel = Number(position.closed?.vPoint?.lvl);
  if (Number.isFinite(exitLevel)) {
    const matchingItem = items.find(
      (item) => item.isAveraged && item.level === exitLevel,
    );
    if (matchingItem) {
      matchingItem.exitMonitoringState = position.lastMonitoringStage;
      matchingItem.isExit = true;
      matchingItem.state = isTargetExitReason(position) ? "target" : "exit";
    } else {
      items.push({
        coveredMarginUsdt: 0,
        exitMonitoringState: position.lastMonitoringStage,
        isAveraged: false,
        isEntry: false,
        isExit: true,
        level: exitLevel,
        state: isTargetExitReason(position) ? "target" : "exit",
      });
    }
  }

  return items;
}
