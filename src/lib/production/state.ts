import type { RuntimeEngineState } from "@/lib/precision/types";
import type { ProductionStateOptions } from "./types";

/** Builds the in-memory state boundary consumed by the shared runtime engine. */
function create(options: ProductionStateOptions): RuntimeEngineState {
  return {
    balance: options.balance,
    blackSwanProtective: options.blackSwanProtective,
    config: options.config,
    currentTime: options.currentTime ?? Date.now(),
    dailyPnlDay: options.dailyPnlDay,
    dailyPnlUsdt: options.dailyPnlUsdt,
    markPriceMap: options.markPriceMap ?? {},
    mode: options.mode,
    openPositions: options.openPositions,
    // Strategy-owned persisted slot (pair ledgers, pending re-entries) —
    // loaded verbatim from `strategy.json[mode]`, never interpreted here.
    strategy: options.strategy,
    vPointsMap: options.vPointsMap ?? {},
  };
}

const state = { create } as const;

export default state;
export { state };
