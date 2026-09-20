import type { RuntimeContext } from "../types";

function captureEntry(context: RuntimeContext) {
  // trying to entry
  // updating the volatility points
  // on strategy feeded with the latest volatility points
  // const decision = await this.onStrategy(this.state, vpointsMap);
  // maybe the decision
  // const result = await this.onAction()
}

const entry = {
  capture: captureEntry,
} as const;

export default entry;
