import type { RuntimeContext } from "../types";

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

const stages = {
  speedup: speedupStages,
  standard: standardStages,
} as const;

export default stages;
