import type { RuntimeContext } from "../types";
import positionMonitoring from "./position";

async function standardStages(context: RuntimeContext) {
  // for each position that lastmonitoredis = standard
  // do monitoring
  // this.monitoring;
  // also check criterion so the position might moved to speedup stages
  // BOTH:MULTI_ACCOUNT_SEQUENTIAL_ACCOUNT_EXECUTION — positions across all
  // accounts are monitored one at a time in deterministic list order.
  for (const position of [...context.state.openPositions]) {
    if (position.lastMonitoringStage?.lastUpdated === context.state.currentTime) {
      continue;
    }
    if (position.lastMonitoringStage?.stage === "speedup") continue;

    await positionMonitoring.monitor(context, position);
  }
}

async function speedupStages(context: RuntimeContext) {
  // for each position that lastmonitoredis = speedup
  // do monitoring
  // this.monitoring;
  // also check criterion so the position might moved to standard stages
  for (const position of [...context.state.openPositions]) {
    if (position.lastMonitoringStage?.lastUpdated === context.state.currentTime) {
      continue;
    }
    if (position.lastMonitoringStage?.stage === "standard") continue;

    await positionMonitoring.monitor(context, position);
  }
}

const stages = {
  speedup: speedupStages,
  standard: standardStages,
} as const;

export default stages;
