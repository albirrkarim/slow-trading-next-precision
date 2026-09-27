import type {
  RuntimeContext,
  RuntimeEntryDecision,
  RuntimePairEntryDecision,
} from "@/lib/precision/types";
import type { Position } from "./types";

/**
 * Runs a pair entry's legs sequentially through the environment-supplied
 * per-leg executor. When a later leg fails or throws, already-filled legs
 * unwind in reverse order through `rollbackLeg` (a compensating close
 * live, a no-op/discard in simulation) so the account never keeps an
 * unpaired leg. Returns the leg-order fills on full success, or null
 * after a complete unwind — the engine commits `openPositions`/balance/
 * vPoint markers only for a returned array. A thrown leg is unwound the
 * same way, then rethrown so the caller sees the execution error.
 */
async function execute(params: {
  context: RuntimeContext;
  decision: RuntimePairEntryDecision;
  executeLeg: (
    leg: RuntimeEntryDecision,
    context: RuntimeContext,
  ) => Promise<Position | null> | Position | null;
  rollbackLeg?: (
    leg: RuntimeEntryDecision,
    position: Position,
    context: RuntimeContext,
  ) => Promise<void> | void;
}): Promise<Position[] | null> {
  const filled: Position[] = [];
  for (const leg of params.decision.legs) {
    let position: Position | null = null;
    let legError: unknown;
    try {
      position = await params.executeLeg(leg, params.context);
    } catch (error) {
      legError = error;
    }
    if (!position) {
      // BOTH:PAIR_ENTRY_ATOMIC_ROLLBACK — a failed or thrown leg unwinds
      // earlier fills before the pair reports failure; a rollback error
      // propagates so the operator is told a leg may still be open on the
      // exchange.
      for (let index = filled.length - 1; index >= 0; index -= 1) {
        await params.rollbackLeg?.(
          params.decision.legs[index],
          filled[index],
          params.context,
        );
      }
      if (legError !== undefined) throw legError;
      return null;
    }
    filled.push(position);
  }
  return filled;
}

const pairAction = {
  execute,
} as const;

export default pairAction;
