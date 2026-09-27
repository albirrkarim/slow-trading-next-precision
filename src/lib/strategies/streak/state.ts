import type { RuntimeContext } from "@/lib/precision/types";

import strategyState from "../shared/state";
import type { PairRole } from "../shared/pair";

/**
 * One recorded empty role inside a pair: the leg closed while its sibling
 * survives, so the pair keeps a pending re-entry for that role. Persisted
 * through the strategy channel so a restart resumes the pending slot.
 */
export interface StreakRoleRecord {
  /** The pair the empty role belongs to — `<accountSlug>:<SYMBOL>:<vPointId>`. */
  pairId: string;
  /** The empty role awaiting re-entry. */
  role: PairRole;
  accountSlug: string;
  symbol: string;
  /**
   * Latest reason the role stays empty — surfaced inline as the empty
   * slot's status (STREAK spec C.1). Cleared when the re-entry is emitted.
   */
  reason?: string;
}

/**
 * `streak`-owned records inside `state.strategy`. Only the empty-role
 * record is persisted — never the anchor: the newest confirmed unused
 * vPoint is resolved fresh every pass (STREAK FAQ 7 semantics).
 */
export interface StreakStrategyState {
  v: "streak";
  /** `pairId` → the pair's empty-role record, when one exists. */
  roles: Record<string, StreakRoleRecord>;
}

function empty(): StreakStrategyState {
  return { roles: {}, v: "streak" };
}

/** Reads (or initializes) the `streak` state slot on the runtime state. */
function read(context: RuntimeContext): StreakStrategyState {
  return strategyState.read(context, "streak", empty);
}

/** Read-only `read` for diagnostics/board paths — never writes the slot. */
function peek(context: RuntimeContext): StreakStrategyState {
  return strategyState.peek(context, "streak", empty);
}

const streakState = {
  peek,
  read,
} as const;

export default streakState;
