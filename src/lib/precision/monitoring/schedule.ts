import slowTradingStages from "@/lib/slowTrading/stages";
import type { RuntimeEngineState } from "../types";

const MINUTE_MS = 60_000;

function getInterval(
  state: RuntimeEngineState,
  stage: "speedup" | "standard-monitoring" | "capture-entry",
): number {
  return slowTradingStages.interval.getMinutes(state.config.runtime, stage);
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

function getNextTime(state: RuntimeEngineState): number {
  const standardTime = getNextBoundary(
    state.currentTime,
    getInterval(state, "standard-monitoring"),
  );
  const captureEntryTime = getNextBoundary(
    state.currentTime,
    getInterval(state, "capture-entry"),
  );
  let nextTime = Math.min(standardTime, captureEntryTime);

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

const schedule = {
  getNextTime,
  isCaptureEntryDue,
  isSpeedupDue,
  isStandardDue,
} as const;

export default schedule;
