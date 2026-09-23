import tradingExit from "@/lib/system/trading/exit";
import type { Position } from "@/lib/system/trading";

import type { RuntimeContext, RuntimeExitDecision } from "../types";

/** Evaluates the exit decision for one open position through the strategy. */
async function find(
  context: RuntimeContext,
  position: Position,
): Promise<RuntimeExitDecision | null> {
  return tradingExit.findDecision(context, position);
}

const exit = { find } as const;

export default exit;
