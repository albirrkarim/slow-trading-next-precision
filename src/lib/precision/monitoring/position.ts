import positions from "../utils/positions";
import type { Position } from "@/lib/system/trading";

import defaultDecision from "../defaultDecision";
import type {
  RuntimeAveragingDecision,
  RuntimeContext,
  RuntimeExitDecision,
} from "../types";

function assertMatchingPosition(
  decision: RuntimeAveragingDecision | RuntimeExitDecision,
  position: Position,
): void {
  if (
    position.account !== decision.accountSlug ||
    position.symbol.toUpperCase() !== decision.symbol ||
    position.opened.t !== decision.position.opened.t
  ) {
    throw new Error(
      `${decision.type} action returned a position that does not match ${decision.accountSlug}/${decision.symbol}.`,
    );
  }
}

/** Updates fee-aware PnL and its bounded configured history bucket. */
function updatePnl(context: RuntimeContext, position: Position): void {
  positions.updatePnl(context, position);
}

/** Reclassifies a still-open position for its next monitoring pass. */
function updateMonitoringStage(
  context: RuntimeContext,
  position: Position,
): void {
  positions.updateMonitoringStage(context, position);
}

/**
 * Doing the averaging and exit
 * @param context
 * @param position
 */
async function monitorPosition(context: RuntimeContext, position: Position) {
  // A. Update historical pnl of the position
  updatePnl(context, position);

  // B. Exit
  if (
    context.state.config.runtime.autoExitEnabled ||
    position.control?.forceExit
  ) {
    const didExit = await exit(context, position);
    if (didExit) return;
  }

  // C. Averaging
  const accountConfig = context.helper.getAccountConfig(position.account);
  let monitoredPosition = position;
  if (accountConfig.enableWatchLogic) {
    monitoredPosition = (await averaging(context, position)) ?? position;
  }

  // D. Decide goes to speedup stage or back to standard stage vice versa
  updateMonitoringStage(context, monitoredPosition);
}

async function averaging(
  context: RuntimeContext,
  position: Position,
): Promise<Position | null> {
  // A. Build the shared default averaging decision from the current runtime
  // snapshot. This does not mutate the open position.
  // context.state.config
  // context.state.markPriceMap
  // context.state.vPointsMap
  // find existing function that doing that or maybe we create it inside the
  // src/lib/precision/defaultDecision
  const decision = await defaultDecision.averaging.find(context, position);
  if (!decision) return null;

  // B. Give the outer strategy an opportunity to approve or reject the
  // candidate before any position or balance mutation occurs.
  if (!(await context.adapter.onStrategy(decision, context))) return null;

  // C. Ask the environment adapter to execute the averaging action.
  // Backtest/sandbox adapters simulate the fill; a live adapter submits it.
  // context.adapter.onAction
  const marginBefore = position.exposure.marginUsdt;
  const feeBefore = position.fees.entryUsdt;
  const reservedBefore =
    position.strategy.averaging.reservedRemainingMarginUsdt;
  const updatedPosition = await context.adapter.onAction(decision, context);
  if (!updatedPosition) return null;
  assertMatchingPosition(decision, updatedPosition);
  if (updatedPosition.closed) {
    throw new Error("Averaging action returned a closed position.");
  }

  // D. Replace the previous open-position snapshot with the position that
  // includes the newly executed averaging fill.
  const positionIndex = context.state.openPositions.indexOf(position);
  if (positionIndex < 0) return null;
  context.state.openPositions[positionIndex] = updatedPosition;

  // E. Apply the shared accounting for the incremental margin, fee, and
  // reserve consumed by this averaging execution.
  const balance = context.helper.getAccountBalance(decision.accountSlug);
  const addedMargin = Math.max(
    0,
    updatedPosition.exposure.marginUsdt - marginBefore,
  );
  const addedFee = Math.max(0, updatedPosition.fees.entryUsdt - feeBefore);
  const reservedAfter =
    updatedPosition.strategy.averaging.reservedRemainingMarginUsdt;
  const consumedReserve = Math.max(0, reservedBefore - reservedAfter);
  balance.available = Math.max(0, balance.available - addedMargin - addedFee);
  balance.locked += addedMargin;
  balance.reserved = Math.max(0, balance.reserved - consumedReserve);
  balance.spendable = Math.max(
    0,
    balance.available - balance.reserved - balance.safeHaven,
  );
  balance.total = balance.available + balance.locked;

  // F. Mark the averaging volatility point as used only after the action and
  // accounting have both succeeded.
  // BOTH:AVERAGING_CONSUMES_VOLATILITY_POINT
  positions.markVPointUsed({
    accountSlug: decision.accountSlug,
    recommendation: decision.recommendation,
    volatilityPoints: context.state.vPointsMap[decision.symbol],
  });

  await context.adapter.onStateChange?.(context);

  return updatedPosition;
}

async function exit(
  context: RuntimeContext,
  position: Position,
): Promise<boolean> {
  // A. Build the shared default exit decision from the current runtime
  // snapshot. This evaluates a clone and does not close the live position.
  // context.state.config
  // context.state.markPriceMap
  // context.state.vPointsMap
  // find existing function that doing that or maybe we create it inside the
  // src/lib/precision/defaultDecision
  const decision = await defaultDecision.exit.find(context, position);
  if (!decision) return false;

  // B. Give the outer strategy an opportunity to approve or reject the
  // candidate before any position or balance mutation occurs.
  if (!(await context.adapter.onStrategy(decision, context))) return false;

  // C. Ask the environment adapter to execute the exit action.
  // Backtest/sandbox adapters simulate the close; a live adapter submits it.
  const closedPosition = await context.adapter.onAction(decision, context);
  if (!closedPosition) return false;
  assertMatchingPosition(decision, closedPosition);
  if (!closedPosition.closed) {
    throw new Error("Exit action returned a position without closed details.");
  }

  // D. Remove the successfully closed position from runtime state.
  const positionIndex = context.state.openPositions.indexOf(position);
  if (positionIndex < 0) return false;
  context.state.openPositions.splice(positionIndex, 1);

  // E. Release margin and reserve, then rebuild the account balance summary
  // from the realized PnL and returned entry margin.
  const balance = context.helper.getAccountBalance(decision.accountSlug);
  const releasedReserve = Math.max(
    0,
    position.strategy.averaging.reservedRemainingMarginUsdt,
  );
  const returnedUsdt = Math.max(
    0,
    closedPosition.exposure.marginUsdt +
      (closedPosition.pnl.netUsdt ?? 0) +
      closedPosition.fees.entryUsdt,
  );
  balance.available += returnedUsdt;
  balance.locked = Math.max(
    0,
    balance.locked - position.exposure.marginUsdt,
  );
  balance.reserved = Math.max(0, balance.reserved - releasedReserve);
  balance.spendable = Math.max(
    0,
    balance.available - balance.reserved - balance.safeHaven,
  );
  balance.total = balance.available + balance.locked;

  // F. Persist the closed position after the shared state is fully updated.
  await context.adapter.onExit(closedPosition, context);

  return true;
}

const position = {
  monitor: monitorPosition,
} as const;

export default position;
