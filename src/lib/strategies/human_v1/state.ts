import type { RuntimeContext } from "@/lib/precision/types";

import strategyState from "../shared/state";

/**
 * `human_v1`-owned records inside `state.strategy`, persisted with the
 * runtime state so a restart resumes them:
 * - `used`: per coin, the newest Supertrend flip time of the alignment
 *   already traded, so one alignment never enters twice.
 */
export interface HumanStrategyState {
  v: "human_v1";
  /** Base symbol → `flipT` of the last alignment that produced an entry. */
  used: Record<string, number>;
}

function empty(): HumanStrategyState {
  return { used: {}, v: "human_v1" };
}

/** Reads (or initializes) the `human_v1` state slot on the runtime state. */
function read(context: RuntimeContext): HumanStrategyState {
  const state = strategyState.read(context, "human_v1", empty);
  // Slots persisted by the earlier EMA-cross version carry `side`/`armed`.
  state.used ??= {};
  return state;
}

/** Read-only `read` for diagnostics — never writes the slot. */
function peek(context: RuntimeContext): HumanStrategyState {
  const state = strategyState.peek(context, "human_v1", empty);
  return state.used ? state : { ...state, used: {} };
}

const humanState = { peek, read } as const;

export default humanState;
