import features from "@/lib/features";
import type { Position } from "@/lib/system/trading";
import { systemLog } from "@/lib/system/logging";

import positions from "../utils/positions";

import defaultDecision from "../defaultDecision";
import guard from "../guard";
import type {
  RuntimeContext,
  RuntimeEntryCandidate,
  RuntimeEntryDecision,
  RuntimePairEntryDecision,
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

/** Returns the leg decisions of one entry candidate (one for singles). */
function decisionLegs(
  decision: RuntimeEntryCandidate,
): RuntimeEntryDecision[] {
  return decision.type === "pairEntry" ? decision.legs : [decision];
}

/**
 * Executes one pair candidate through the environment's atomic pair hook.
 * Returns null — with `onActionResult("failed")` — when the adapter has no
 * pair support or the execution did not produce every leg.
 */
async function executePair(
  context: RuntimeContext,
  decision: RuntimePairEntryDecision,
): Promise<Position[] | null> {
  const execute = context.adapter.onPairAction;
  if (!execute) {
    // BOTH:PAIR_ENTRY_ADAPTER_REQUIRED — falling back to per-leg `onAction`
    // would execute the first leg unpaired when the second vetoes, so the
    // candidate is rejected instead.
    systemLog.warn(
      `[Precision] pairEntry skipped — adapter has no onPairAction ` +
        `(${decision.accountSlug}/${decision.symbol})`,
    );
    return null;
  }
  const filled = await execute(decision, context);
  if (!filled || filled.length === 0) return null;
  if (filled.length !== decision.legs.length) {
    throw new Error(
      `Pair entry action returned ${filled.length} positions for ` +
        `${decision.legs.length} legs on ` +
        `${decision.accountSlug}/${decision.symbol} — the adapter must ` +
        `either fill every leg or return null after unwinding.`,
    );
  }
  return filled;
}

/**
 * Runs one produced entry candidate — a single entry or an atomic pair —
 * through the approval gate, the environment execution, and the commit
 * bookkeeping. Returns the committed positions (leg order), or null when
 * the candidate was vetoed or produced no fills. Manual operator entries
 * reach the same path as decisions discovered by the default pipeline.
 */
async function executeDecision(
  context: RuntimeContext,
  decision: RuntimeEntryCandidate,
): Promise<Position[] | null> {
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

  // C. Execute — adapter.onPairAction owns an atomic pair fill (sequential
  //    legs + compensating rollback on a partial fill); adapter.onAction
  //    owns the single-leg fill. The strategy only observes the outcome
  //    through onActionResult.
  const filled =
    decision.type === "pairEntry"
      ? await executePair(context, decision)
      : await context.adapter
          .onAction(decision, context)
          .then((position) => (position ? [position] : null));
  if (!filled?.length) {
    await context.strategy?.onActionResult?.(
      "failed",
      decision,
      null,
      context,
    );
    return null;
  }

  // D. Commit — the adapter returned leg-order positions; every leg gets
  //    the same bookkeeping: identity check, strategy payload copy,
  //    open-position list, balance, and vPoint markers.
  const legs = decisionLegs(decision);
  for (const [index, position] of filled.entries()) {
    const leg = legs[index];
    if (
      position.account !== leg.accountSlug ||
      position.symbol.toUpperCase() !== leg.symbol.toUpperCase()
    ) {
      throw new Error(
        `Entry action returned a position that does not match ` +
          `${leg.accountSlug}/${leg.symbol.toUpperCase()}.`,
      );
    }
    // The decision→position hop: the strategy's leg payload (e.g.
    // `{pairId, role, entryLegs}`) lands on `position.strategy.logic` so
    // producers, the pair-aware guard, and `onActionResult` can correlate
    // legs for the position's whole persisted lifecycle. The entry-feature
    // snapshot lands on `position.strategy.entry.feature` — the leg's own
    // `feature` payload wins, else the live feature store pruned to the
    // BTC anchor plus the leg's symbol (cloned so context features travel
    // with the position and later store ticks never mutate the record).
    const logic = leg.strategy;
    const feature =
      leg.feature ??
      features.prune.forPosition(context.state.features, leg.symbol);
    if (logic !== undefined || feature !== undefined) {
      position.strategy = {
        ...position.strategy,
        entry: {
          ...position.strategy.entry,
          ...(feature !== undefined ? { feature } : {}),
        },
        ...(logic !== undefined ? { logic } : {}),
      };
    }
    context.state.openPositions.push(position);
    recordEntryBalance(
      context,
      leg,
      position.exposure.marginUsdt,
      position.fees.entryUsdt,
      position.strategy.averaging.reservedRemainingMarginUsdt,
    );
    positions.markVPointUsed({
      accountSlug: leg.accountSlug,
      markers: leg.vPointUsage,
      recommendation: leg.entrySignal,
      volatilityPoints: context.state.vPointsMap[leg.symbol.toUpperCase()],
    });
  }

  // Strategy bookkeeping observes the pair as one unit before the
  // persistence flush so its mutations ride the same write.
  await context.strategy?.onActionResult?.(
    "success",
    decision,
    decision.type === "pairEntry" ? filled : filled[0],
    context,
  );
  await context.adapter.onStateChange?.(context, decision.accountSlug);

  return filled;
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
