import type { Position } from "@/lib/system/trading";

import { vPointSide } from "./items";
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
  // Averaging steps sit on the adverse side of the entry direction.
  const adverseSide = position.direction === "LONG" ? ("B" as const) : ("T" as const);
  const executions = [...(position.strategy.averaging.executions ?? [])].sort(
    (left, right) => left.t - right.t,
  );
  const steps = position.strategy.averaging.steps ?? [];
  const stepByLevel = new Map(
    steps
      .filter((step) => Number.isFinite(step.level))
      .map((step) => [step.level, step]),
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
        side: vPointSide(position.opened.vPoint),
        state: "passed",
      },
    ];

    for (const point of intermediatePoints) {
      const execution = executionByLevel.get(point.lvl);
      const step = stepByLevel.get(point.lvl);
      const isAveraged = execution !== undefined;
      const isAdverseLevel =
        position.direction === "LONG" ? point.lvl < 0 : point.lvl > 0;
      const isDeeperThanEntry = Math.abs(point.lvl) > Math.abs(entryLevel);

      items.push({
        adaptiveMultiplier: execution?.adaptiveMultiplier,
        attemptMessage: isAveraged ? undefined : step?.attemptMessage,
        attemptedAt: isAveraged ? undefined : step?.attemptedAt,
        averagingMultiplier: execution?.allocationPct,
        coveredMarginUsdt: 0,
        isAveraged,
        isEntry: false,
        level: point.lvl,
        marginUsdt: execution?.marginUsdt ?? step?.marginUsdt,
        monitoringState: execution?.monitoringState,
        reserveStatus: isAveraged ? "USED" : step?.status,
        side: vPointSide(point),
        state:
          !isAveraged && isAdverseLevel && isDeeperThanEntry
            ? "skipped"
            : "passed",
      });
    }

    for (const step of steps) {
      if (
        step.attemptMessage !== undefined &&
        !items.some((item) => item.level === step.level)
      ) {
        items.push({
          attemptMessage: step.attemptMessage,
          attemptedAt: step.attemptedAt,
          coveredMarginUsdt: 0,
          isAveraged: false,
          isEntry: false,
          level: step.level,
          reserveStatus: step.status,
          side: adverseSide,
          state: "skipped",
        });
      }
    }

    const exitLevel = Number(position.closed?.vPoint?.lvl);
    if (Number.isFinite(exitLevel)) {
      const execution = executionByLevel.get(exitLevel);
      const step = stepByLevel.get(exitLevel);
      // The persisted path excludes the exit vPoint itself, so no
      // intermediate item can be its anchor — the exit chip belongs at
      // the chronologically last slot, not on the first same-level point.
      items.push({
        adaptiveMultiplier: execution?.adaptiveMultiplier,
        attemptMessage: step?.attemptMessage,
        attemptedAt: step?.attemptedAt,
        averagingMultiplier: execution?.allocationPct,
        coveredMarginUsdt: 0,
        exitMonitoringState: position.lastMonitoringStage,
        isAveraged: execution !== undefined,
        isEntry: false,
        isExit: true,
        level: exitLevel,
        marginUsdt: execution?.marginUsdt,
        monitoringState: execution?.monitoringState,
        reserveStatus: execution ? "USED" : step?.status,
        side: vPointSide(position.closed?.vPoint ?? {}),
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
          side: vPointSide(position.opened.vPoint),
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
      side: adverseSide,
      state: "passed",
    });
  }

  for (const step of steps) {
    if (
      step.attemptMessage !== undefined &&
      !items.some((item) => item.level === step.level)
    ) {
      items.push({
        attemptMessage: step.attemptMessage,
        attemptedAt: step.attemptedAt,
        coveredMarginUsdt: 0,
        isAveraged: false,
        isEntry: false,
        level: step.level,
        reserveStatus: step.status,
        side: adverseSide,
        state: "skipped",
      });
    }
  }

  const exitLevel = Number(position.closed?.vPoint?.lvl);
  if (Number.isFinite(exitLevel)) {
    const step = stepByLevel.get(exitLevel);
    items.push({
      attemptMessage: step?.attemptMessage,
      attemptedAt: step?.attemptedAt,
      coveredMarginUsdt: 0,
      exitMonitoringState: position.lastMonitoringStage,
      isAveraged: false,
      isEntry: false,
      isExit: true,
      level: exitLevel,
      reserveStatus: step?.status,
      side: vPointSide(position.closed?.vPoint ?? {}),
      state: isTargetExitReason(position) ? "target" : "exit",
    });
  }

  for (const step of steps) {
    if (
      step.attemptMessage &&
      !items.some((item) => item.level === step.level)
    ) {
      items.push({
        attemptMessage: step.attemptMessage,
        attemptedAt: step.attemptedAt,
        coveredMarginUsdt: 0,
        isAveraged: false,
        isEntry: false,
        level: step.level,
        reserveStatus: step.status,
        state: "skipped",
      });
    }
  }

  return items;
}
