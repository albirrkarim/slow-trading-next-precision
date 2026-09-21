import type { RuntimeEngineState } from "@/lib/precision/types";
import type { ProductionStateOptions } from "./types";

/** Builds the in-memory state boundary consumed by the shared runtime engine. */
function create(options: ProductionStateOptions): RuntimeEngineState {
  return {
    balance: options.balance,
    config: options.config,
    currentTime: options.currentTime ?? Date.now(),
    markPriceMap: options.markPriceMap ?? {},
    mode: options.mode,
    openPositions: options.openPositions,
    vPointsMap: options.vPointsMap ?? {},
  };
}

const state = { create } as const;

export default state;
export { state };
