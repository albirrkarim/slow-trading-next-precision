import tradingAveraging from "@/lib/system/trading/averaging";
import type { Position } from "@/lib/system/trading";

import type {
  RuntimeAveragingDecision,
  RuntimeContext,
} from "../types";

/** Finds the watch recommendation for one open position through the strategy. */
async function find(
  context: RuntimeContext,
  position: Position,
): Promise<RuntimeAveragingDecision | null> {
  return tradingAveraging.findDecision(context, position);
}

const averaging = { find } as const;

export default averaging;
