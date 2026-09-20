import slowTradingStages from "@/lib/slowTrading/stages";
import type { RuntimeContext, RuntimeEngineState } from "./types";

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

function standardStages(_context: RuntimeContext) {
  // for each position that lastmonitoredis = standard
  // do monitoring
  // this.monitoring;
  // also check criterion so the position might moved to speedup stages
}

function speedupStages(_context: RuntimeContext) {
  // for each position that lastmonitoredis = speedup
  // do monitoring
  // this.monitoring;
  // also check criterion so the position might moved to standard stages
}

function monitorPosition(_context: RuntimeContext) {
  // Shared market data. the latest price etc..
  // then the data Consumed by
  // this.averaging(data);
  // this.exit(data);
  // this.updateBalance;
}

function captureEntry(_context: RuntimeContext) {
  // trying to entry
  // updating the volatility points
  // on strategy feeded with the latest volatility points
  // const decision = await this.onStrategy(this.state, vpointsMap);
  // maybe the decision
  // const result = await this.onAction()
}

function averaging(_context: RuntimeContext) {
  // trying to do averaging
  // telling outside todo something, maybe real execution etc
  // const result = await this.onAction();
  // from the result we record back to internal runtime engine stage
  // is success?
  // is it changing the position data
  // is it closed the position
  // is it live mode?
  // if yes we need to call exchange update balance
  // if not we do the calculation to update the balance with the current trade result.
}

function exit(_context: RuntimeContext) {
  // trying to do exit from the open position
  // using the config and the exit rules/ conditions we decide the exit.
  // telling outside todo something, maybe real execution etc
  // const result = await this.onAction();
  // from the result we record back to internal runtime engine stage
  // is success?
  // is it changing the position data
  // is it closed the position
  // is it live mode?
  // if yes we need to call exchange update balance
  // if not we do the calculation to update the balance with the current trade result.
}

const runtimeSchedule = {
  getNextTime,
  isCaptureEntryDue,
  isSpeedupDue,
  isStandardDue,
} as const;

const monitoring = {
  captureEntry,
  position: {
    averaging,
    exit,
    monitor: monitorPosition,
  },
  stages: {
    speedup: speedupStages,
    standard: standardStages,
  },
} as const;

export { monitoring, runtimeSchedule };
