import tradingExit from "@/lib/system/trading/exit";
import type {
  Position,
  PositionCloseReason,
} from "@/lib/system/trading";
import type {
  RuntimeContext,
  RuntimeExitDecision,
} from "@/lib/precision/types";

/**
 * Builds an exit decision that closes `position` immediately, regardless of
 * the OR-ed exit rules — the strategy's coordinated-close primitive.
 *
 * The decision rides the standard exit pipeline: a cloned position with
 * `control.forceExit` set flows through `tradingExit.findDecision`, whose
 * evaluator produces a valid SELL `tradeDecision` (executable by every
 * environment adapter). The originating `reason`/`message` are then stamped
 * onto the closed clone so history records the strategy's own label — e.g.
 * `BOTH:EXIT_TOGETHER_WHEN_STOP_LOSS` keeps the sibling's stop-loss reason
 * instead of the generic `FORCED` stamp.
 */
async function force(
  context: RuntimeContext,
  position: Position,
  reason: PositionCloseReason,
  message: string,
  strategy?: unknown,
): Promise<RuntimeExitDecision | null> {
  const forced = structuredClone(position);
  forced.control = {
    ...forced.control,
    forceExit: { reason: message },
  };

  const decision = await tradingExit.findDecision(context, forced);
  if (!decision || !decision.tradeDecision.position?.closed) return null;

  decision.tradeDecision.position.closed.reason = reason;
  decision.tradeDecision.position.closed.message = message;
  decision.tradeDecision.reason = message;
  // The live position ref stays on the decision — the forced clone only
  // seeded the evaluator; matching asserts run against opened.t anyway.
  decision.position = position;
  decision.strategy = strategy;
  decision.message = message;
  return decision;
}

const close = {
  force,
} as const;

export default close;
