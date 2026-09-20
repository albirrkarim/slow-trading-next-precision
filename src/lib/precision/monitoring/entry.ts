import type { RuntimeContext } from "../types";

function captureEntry(context: RuntimeContext) {
  // A. the we decide the default entry signal
  // context.state.config
  // context.state.markPriceMap
  // context.state.vPointsMap
  // find existing function that doing that or maybe we create it inside the
  // src/lib/precision/defaultDecision
  // B. Call the onStrategy for the final confirmation approved to entry
  // context.adapter.onStrategy
  // C. then the actual entry
  // context.adapter.onAction
}

const entry = {
  capture: captureEntry,
} as const;

export default entry;
