import tradingExit from "@/lib/system/trading/exit";
import reserve from "@/lib/system/trading/reserve";
import type { Position } from "@/lib/system/trading";
import { resolveVolatilityThreshold } from "@/lib/system/constants";
import type {
  RuntimeContext,
  RuntimeExitDecision,
} from "@/lib/precision/types";

import close from "../shared/close";
import pair from "../shared/pair";

/**
 * Favorable distance from the latest (still forming) vPoint — the STREAK
 * exception condition: once price moved at least `VOLATILITY_THRESHOLD`
 * percent to the position's profit side, an opposite vPoint is forming and
 * the ordinary TP%/SL+ rules re-enable for this leg.
 */
function favorableDistancePct(params: {
  currentPrice?: number;
  direction?: Position["direction"];
  lastVolatilityPrice?: number;
}): number {
  const { currentPrice, direction, lastVolatilityPrice } = params;
  if (
    !(
      typeof currentPrice === "number" &&
      Number.isFinite(currentPrice) &&
      currentPrice > 0
    ) ||
    !(
      typeof lastVolatilityPrice === "number" &&
      Number.isFinite(lastVolatilityPrice) &&
      lastVolatilityPrice > 0
    )
  ) {
    return 0;
  }
  const raw = ((currentPrice - lastVolatilityPrice) / lastVolatilityPrice) * 100;
  return direction === "SHORT" ? -raw : raw;
}

/**
 * `streak` exit producer — the direction-based rail plus the OR-ed shared
 * rules under the strategy's TP gating:
 *
 * 1. STREAK:VOLATILITY_TARGET_EXIT — the first confirmed post-entry TOP
 *    (LONG) or BOTTOM (SHORT) closes THIS leg only; the adverse sibling
 *    keeps evaluating independently (no pair cascade — FAQ 6).
 * 2. The shared evaluator — traditional TP% and Stop-Loss+ stay disabled
 *    for pair legs (rail exits lead) until the exception condition: a
 *    favorable distance ≥ VOLATILITY_THRESHOLD from the latest vPoint
 *    re-enables them. All other exits (hard SL, USDT SL, level drift,
 *    post-average, rescue) run unchanged as OR conditions.
 */
async function find(
  context: RuntimeContext,
  position: Position,
): Promise<RuntimeExitDecision | null> {
  const meta = pair.meta.ofPosition(position);
  if (!meta) {
    return tradingExit.findDecision(context, position);
  }

  const symbol = position.symbol.toUpperCase();
  const points = context.state.vPointsMap[symbol] ?? [];

  // The entry vPoint itself cannot satisfy the target — a leg opened on a
  // same-label point (e.g. a COUNTER LONG at TOP[0]) would otherwise close
  // on its own anchor and loop close/reopen.
  const target = reserve.vpoints.findPositionTargetPoint({
    position,
    volatilityPoints: points.filter(
      (point) => point.id !== position.opened.vPoint.id,
    ),
  });
  if (target) {
    return close.force(
      context,
      position,
      "VOLATILITY_TARGET_EXIT",
      `[SELL] STREAK:VOLATILITY_TARGET_EXIT — favorable rail reached at ` +
        `${target.l}[${target.lvl}] price ${target.p}`,
      { pairId: meta.pairId },
    );
  }

  const lastPoint = points.at(-1);
  const tpReenabled =
    favorableDistancePct({
      currentPrice: context.state.markPriceMap[symbol]?.price,
      direction: position.direction,
      lastVolatilityPrice: lastPoint?.p,
    }) >= resolveVolatilityThreshold(context.state.config.management);

  return tradingExit.findDecision(context, position, {
    config: tpReenabled
      ? undefined
      : {
          takeProfitPercent: Number.POSITIVE_INFINITY,
          useStopLossPlus: false,
        },
  });
}

const streakExit = {
  find,
} as const;

export default streakExit;
