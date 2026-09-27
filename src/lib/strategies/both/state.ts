import type { RuntimeContext } from "@/lib/precision/types";
import type { PositionCloseReason } from "@/lib/system/trading";
import type { PairClosedLeg } from "../shared/pair";
import strategyState from "../shared/state";

/**
 * `both` strategy state persisted under `state.strategy` by the production
 * adapter after each engine pass.
 */
export interface BothStrategyState {
  /**
   * Slim snapshot of the pair leg that closed while its sibling is still
   * open, keyed by `pairId`. Removed when the sibling leg closes too —
   * a pair only reaches fully-closed when both legs exit, so at most one
   * closed-leg snapshot ever exists per pairId.
   */
  closed: Record<string, PairClosedLeg>;
  /**
   * Sibling legs that still must be force-closed after a cascade exit
   * (catalog removal, blacklist, auto-removed). The exit-side candidate
   * producer reads this so the surviving leg is closed right away.
   */
  pendingClose: Record<
    string,
    { message: string; reason: PositionCloseReason }
  >;
  /** Persisted strategy-state version. */
  v: "both";
}

function empty(): BothStrategyState {
  return { closed: {}, pendingClose: {}, v: "both" };
}

function read(context: RuntimeContext): BothStrategyState {
  const state = strategyState.read(context, "both", empty);
  // Persisted slots written before `closed`/`pendingClose` existed still
  // load — normalize them in place so writes below always find a record.
  state.closed ??= {};
  state.pendingClose ??= {};
  return state;
}

function peek(context: RuntimeContext): BothStrategyState {
  return strategyState.peek(context, "both", empty);
}

const bothState = {
  peek,
  read,
};

export default bothState;
