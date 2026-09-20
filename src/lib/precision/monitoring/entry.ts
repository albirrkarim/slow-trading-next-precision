import slowTradingWatchReserve from "@/lib/slowTrading/watch-reserve";

import defaultDecision from "../defaultDecision";
import type {
  RuntimeContext,
  RuntimeEntryDecision,
} from "../types";

/** Checks account limits again after every sequential entry attempt. */
function canAttemptEntry(
  context: RuntimeContext,
  decision: RuntimeEntryDecision,
): boolean {
  const account = context.helper.getAccount(decision.accountSlug);
  if (!account.enabled) return false;
  if (context.state.mode === "sandbox" && !account.sandbox.enabled) {
    return false;
  }

  const openPositions = context.state.openPositions.filter(
    (position) =>
      position.account === decision.accountSlug && !position.closed,
  );
  if (
    openPositions.some(
      (position) => position.symbol.toUpperCase() === decision.symbol,
    )
  ) {
    return false;
  }

  const maximum = Math.max(
    0,
    Math.floor(Number(account.trading.maxOpenPositions) || 0),
  );
  return maximum === 0 || openPositions.length < maximum;
}

/** Applies the successful entry to the runtime's mutable balance summary. */
function recordEntryBalance(
  context: RuntimeContext,
  decision: RuntimeEntryDecision,
  marginUsdt: number,
  entryFeeUsdt: number,
): void {
  const balance = context.helper.getAccountBalance(decision.accountSlug);
  balance.available = Math.max(
    0,
    balance.available - marginUsdt - entryFeeUsdt,
  );
  balance.locked += marginUsdt;
  balance.spendable = Math.max(
    0,
    balance.available - balance.reserved - balance.safeHaven,
  );
  balance.total = balance.available + balance.locked;
}

async function captureEntry(context: RuntimeContext): Promise<void> {
  // A. the we decide the default entry signal
  // context.state.config
  // context.state.markPriceMap
  // context.state.vPointsMap
  // find existing function that doing that or maybe we create it inside the
  // src/lib/precision/defaultDecision
  const decisions = await defaultDecision.entry.find(context);

  for (const decision of decisions) {
    if (!canAttemptEntry(context, decision)) continue;

    // B. Call the onStrategy for the final confirmation approved to entry
    // context.adapter.onStrategy
    if (!(await context.adapter.onStrategy(decision, context))) continue;

    // C. then the actual entry
    // context.adapter.onAction
    const position = await context.adapter.onAction(decision, context);
    if (!position) continue;
    if (
      position.account !== decision.accountSlug ||
      position.symbol.toUpperCase() !== decision.symbol
    ) {
      throw new Error(
        `Entry action returned a position that does not match ${decision.accountSlug}/${decision.symbol}.`,
      );
    }

    context.state.openPositions.push(position);
    recordEntryBalance(
      context,
      decision,
      position.exposure.marginUsdt,
      position.fees.entryUsdt,
    );
    slowTradingWatchReserve.volatilityPoint.markAccountUsed({
      accountSlug: decision.accountSlug,
      entrySignal: decision.entrySignal,
      volatilityPoints: context.state.vPointsMap[decision.symbol],
    });
  }
}

const entry = {
  capture: captureEntry,
} as const;

export default entry;
