import tradingEntry from "@/lib/system/trading/entry";

import type { RuntimeContext, RuntimeEntryDecision } from "../types";

/** Finds entry decisions through the default system strategy. */
async function find(context: RuntimeContext): Promise<RuntimeEntryDecision[]> {
  return tradingEntry.findDecisions(context);
}

const entry = { find } as const;

export default entry;
