import positions from "../utils/positions";
import type { Position } from "@/lib/system/trading";

import defaultDecision from "../defaultDecision";
import guard from "../guard";
import type {
  RuntimeContext,
  RuntimeEntryDecision,
} from "../types";

/** Applies the successful entry to the runtime's mutable balance summary. */
function recordEntryBalance(
  context: RuntimeContext,
  decision: RuntimeEntryDecision,
  marginUsdt: number,
  entryFeeUsdt: number,
  reservedMarginUsdt: number,
): void {
  const balance = context.helper.getAccountBalance(decision.accountSlug);
  balance.available = Math.max(
    0,
    balance.available - marginUsdt - entryFeeUsdt,
  );
  balance.locked += marginUsdt;
  balance.reserved += Math.max(0, reservedMarginUsdt);
  balance.spendable = Math.max(
    0,
    balance.available - balance.reserved - balance.safeHaven,
  );
  balance.total = balance.available + balance.locked;
}

/**
 * Runs one produced entry decision through the approval gate, the
 * environment execution, and the commit bookkeeping. Manual operator
 * entries reach the same path as decisions discovered by the default
 * pipeline.
 */
async function executeDecision(
  context: RuntimeContext,
  decision: RuntimeEntryDecision,
): Promise<Position | null> {
  // B. Approve — the active guard (strategy override or shared default),
  //    then the adapter's optional env extension (production's live
  //    catalog re-read). onActionEnvGuard is never strategy-overridable.
  const activeGuard = context.strategy?.guard ?? guard;
  if (!activeGuard.allows(decision, context)) return null;
  if (
    !(await (context.adapter.onActionEnvGuard?.(decision, context) ?? true))
  ) {
    return null;
  }

  // C. Execute — adapter.onAction owns the fill; a strategy only observes
  //    the outcome through onActionResult.
  const position = await context.adapter.onAction(decision, context);
  if (!position) {
    await context.strategy?.onActionResult?.("failed", decision, null, context);
    return null;
  }
  if (
    position.account !== decision.accountSlug ||
    position.symbol.toUpperCase() !== decision.symbol
  ) {
    throw new Error(
      `Entry action returned a position that does not match ${decision.accountSlug}/${decision.symbol}.`,
    );
  }

  // D. Commit — open-position list, balance, and vPoint markers, then
  //    strategy.onActionResult before onStateChange so strategy mutations
  //    (pair legs, pending re-entries) persist in the same flush.
  context.state.openPositions.push(position);
  recordEntryBalance(
    context,
    decision,
    position.exposure.marginUsdt,
    position.fees.entryUsdt,
    position.strategy.averaging.reservedRemainingMarginUsdt,
  );
  positions.markVPointUsed({
    accountSlug: decision.accountSlug,
    markers: decision.vPointUsage,
    recommendation: decision.entrySignal,
    volatilityPoints: context.state.vPointsMap[decision.symbol],
  });
  await context.strategy?.onActionResult?.("success", decision, position, context);
  await context.adapter.onStateChange?.(context, decision.accountSlug);

  return position;
}

async function captureEntry(context: RuntimeContext): Promise<void> {
  // A. Produce candidates — the strategy's decisions.entry producer when
  //    present, else defaultDecision.entry; inputs come from context.state
  //    (config, markPriceMap, vPointsMap).
  const producer = context.strategy?.decisions?.entry ?? defaultDecision.entry;
  const decisions = await producer.find(context);

  for (const decision of decisions) {
    await executeDecision(context, decision);
  }
}

const entry = {
  capture: captureEntry,
  executeDecision,
} as const;

export default entry;
