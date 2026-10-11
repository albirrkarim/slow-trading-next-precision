import type { RuntimeContext } from "@/lib/precision/types";

import strategyState from "../shared/state";
import type { EmaSide } from "./signal";

/**
 * `human_v1`-owned records inside `state.strategy`, persisted with the
 * runtime state so a restart resumes them:
 * - `side`: the EMA side each coin was on at the previous capture pass, so
 *   only an actual cross counts (never mid-trend on first boot);
 * - `armed`: the direction of a fresh cross still waiting for its entry
 *   confirmation (distance from the EMA + Supertrend agreement).
 */
export interface HumanStrategyState {
  v: "human_v1";
  /** Base symbol → last observed non-zero EMA side (1 above, -1 below). */
  side: Record<string, Exclude<EmaSide, 0>>;
  /** Base symbol → direction of the fresh cross awaiting confirmation. */
  armed: Record<string, Exclude<EmaSide, 0>>;
}

function empty(): HumanStrategyState {
  return { armed: {}, side: {}, v: "human_v1" };
}

/** Reads (or initializes) the `human_v1` state slot on the runtime state. */
function read(context: RuntimeContext): HumanStrategyState {
  const state = strategyState.read(context, "human_v1", empty);
  // Slots persisted before `armed` existed.
  state.armed ??= {};
  return state;
}

/** Read-only `read` for diagnostics — never writes the slot. */
function peek(context: RuntimeContext): HumanStrategyState {
  const state = strategyState.peek(context, "human_v1", empty);
  return state.armed ? state : { ...state, armed: {} };
}

const humanState = { peek, read } as const;

export default humanState;
