import type { RuntimeContext } from "@/lib/precision/types";

import strategyState from "../shared/state";
import type { PairRole } from "../shared/pair";

/**
 * One recorded empty role inside a pair: the leg closed while its sibling
 * survives, so the pair keeps a pending re-entry for that role. Persisted
 * through the strategy channel so a restart resumes the pending slot.
 */
export interface ProfitRailRoleRecord {
  /** The pair the empty role belongs to — `<accountSlug>:<SYMBOL>:<vPointId>`. */
  pairId: string;
  /** The empty role awaiting re-entry. */
  role: PairRole;
  accountSlug: string;
  symbol: string;
  /**
   * Latest reason the role stays empty — surfaced inline as the empty
   * slot's status. Cleared when the re-entry is emitted.
   */
  reason?: string;
}

/**
 * `custom_swe_2_profit_rail_v1`-owned records inside `state.strategy`. Same
 * shape as `streak`'s: only the empty-role record is persisted — never the
 * anchor: the newest confirmed unused in-band vPoint is resolved fresh
 * every pass.
 */
export interface ProfitRailStrategyState {
  v: "custom_swe_2_profit_rail_v1";
  /** `pairId` → the pair's empty-role record, when one exists. */
  roles: Record<string, ProfitRailRoleRecord>;
}

function empty(): ProfitRailStrategyState {
  return { roles: {}, v: "custom_swe_2_profit_rail_v1" };
}

/** Reads (or initializes) this strategy's state slot on the runtime state. */
function read(context: RuntimeContext): ProfitRailStrategyState {
  return strategyState.read(context, "custom_swe_2_profit_rail_v1", empty);
}

/** Read-only `read` for diagnostics/board paths — never writes the slot. */
function peek(context: RuntimeContext): ProfitRailStrategyState {
  return strategyState.peek(context, "custom_swe_2_profit_rail_v1", empty);
}

const profitRailState = {
  peek,
  read,
} as const;

export default profitRailState;
