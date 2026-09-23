import type { RuntimeEngineAdapter, RuntimeEngineState } from "../types";

const MINUTE_MS = 60_000;

/** Engine-dispatched stages with configurable cadence. */
type ScheduledStage =
  | "risk-sentinel"
  | "speedup"
  | "standard-monitoring"
  | "management"
  | "capture-entry";

/** Normalizes a stage interval to a positive whole number of minutes. */
function normalizeIntervalMinutes(
  value: unknown,
  fallbackMinutes: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallbackMinutes;
  }

  return Math.max(1, Math.floor(parsed));
}

function getInterval(
  state: RuntimeEngineState,
  stage: ScheduledStage,
): number {
  const runtime = state.config.runtime;
  if (stage === "risk-sentinel") {
    return normalizeIntervalMinutes(runtime.blackSwanStageIntervalMinutes, 1);
  }
  if (stage === "speedup") {
    return normalizeIntervalMinutes(runtime.speedupStageIntervalMinutes, 1);
  }
  if (stage === "standard-monitoring") {
    return normalizeIntervalMinutes(
      runtime.standardMonitoringStageIntervalMinutes,
      5,
    );
  }
  if (stage === "management") {
    return normalizeIntervalMinutes(runtime.managementStageIntervalMinutes, 5);
  }
  return normalizeIntervalMinutes(runtime.captureEntryStageIntervalMinutes, 5);
}

function getNextBoundary(currentTime: number, intervalMinutes: number): number {
  const intervalMs = intervalMinutes * MINUTE_MS;
  return Math.floor(currentTime / intervalMs) * intervalMs + intervalMs;
}

function isDue(currentTime: number, intervalMinutes: number): boolean {
  return Math.floor(currentTime / MINUTE_MS) % intervalMinutes === 0;
}

function hasSpeedupPosition(state: RuntimeEngineState): boolean {
  return state.openPositions.some(
    (position) =>
      !position.closed && position.lastMonitoringStage?.stage === "speedup",
  );
}

type EnvironmentStageAdapter = Pick<
  RuntimeEngineAdapter,
  "onManagement" | "onRiskSentinel"
>;

function getNextTime(
  state: RuntimeEngineState,
  adapter?: EnvironmentStageAdapter,
): number {
  const standardTime = getNextBoundary(
    state.currentTime,
    getInterval(state, "standard-monitoring"),
  );
  const captureEntryTime = getNextBoundary(
    state.currentTime,
    getInterval(state, "capture-entry"),
  );
  let nextTime = Math.min(standardTime, captureEntryTime);

  if (adapter?.onRiskSentinel) {
    nextTime = Math.min(
      nextTime,
      getNextBoundary(state.currentTime, getInterval(state, "risk-sentinel")),
    );
  }

  if (adapter?.onManagement) {
    nextTime = Math.min(
      nextTime,
      getNextBoundary(state.currentTime, getInterval(state, "management")),
    );
  }

  if (hasSpeedupPosition(state)) {
    nextTime = Math.min(
      nextTime,
      getNextBoundary(state.currentTime, getInterval(state, "speedup")),
    );
  }

  return nextTime;
}

function isSpeedupDue(state: RuntimeEngineState): boolean {
  return (
    hasSpeedupPosition(state) &&
    isDue(state.currentTime, getInterval(state, "speedup"))
  );
}

function isStandardDue(state: RuntimeEngineState): boolean {
  return isDue(state.currentTime, getInterval(state, "standard-monitoring"));
}

function isCaptureEntryDue(state: RuntimeEngineState): boolean {
  return isDue(state.currentTime, getInterval(state, "capture-entry"));
}

function isRiskSentinelDue(state: RuntimeEngineState): boolean {
  return isDue(state.currentTime, getInterval(state, "risk-sentinel"));
}

function isManagementDue(state: RuntimeEngineState): boolean {
  return isDue(state.currentTime, getInterval(state, "management"));
}

const schedule = {
  getNextTime,
  isCaptureEntryDue,
  isManagementDue,
  isRiskSentinelDue,
  isSpeedupDue,
  isStandardDue,
} as const;

export default schedule;
