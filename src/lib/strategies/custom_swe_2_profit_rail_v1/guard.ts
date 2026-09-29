import type { RuntimeContext, RuntimeDecision } from "@/lib/precision/types";

import pair from "../shared/pair";
import pairGuard from "../shared/guard";
import profitRailState from "./state";

/**
 * Wraps the pair guard: on a vetoed `reopen` entry the pair's empty-role
 * record picks up the guard-blocked reason so the empty-slot card surfaces
 * why the re-entry did not fire.
 */
function allows(decision: RuntimeDecision, context: RuntimeContext): boolean {
  if (pairGuard.allows(decision, context)) return true;

  if (decision.type === "entry") {
    const meta = pair.meta.ofDecision(decision);
    if (meta?.reopen) {
      const record = profitRailState.read(context).roles[meta.pairId];
      if (record) {
        record.reason =
          "Re-entry blocked by the entry guard (runner, auto-entry, " +
          "catalog, minimum price, forming vPoint, entry cutoff, daily " +
          "PnL, or capacity).";
      }
    }
  }

  return false;
}

const profitRailGuard = {
  allows,
} as const;

export default profitRailGuard;
