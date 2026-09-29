import tradingExit from "@/lib/system/trading/exit";
import reserve from "@/lib/system/trading/reserve";
import type { Position } from "@/lib/system/trading";
import { VOLATILITY_THRESHOLD } from "@/lib/system/constants";
import type {
  RuntimeContext,
  RuntimeExitDecision,
} from "@/lib/precision/types";

import close from "../shared/close";
import pair from "../shared/pair";

/**
 * Rail-exit profit gate (unlevered fee-adjusted net %). The streak rail
 * closes a leg at the first post-entry counter point regardless of PnL —
 * on shallow waves that books a ~-1.8 USDT average loss. This variant
 * exits on the rail only while the position is not at a loss; a rail that
 * arrives underwater is skipped and the leg falls through to the shared
 * rules (volatility-target SL after the target zone exists, post-average
 * rescue, drift/USDT/percent stops, and SL+ once re-enabled).
 */
export const RAIL_EXIT_MIN_NET_PCT = 0;

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
 * `custom_swe_2_profit_rail_v1` exit producer — streak's rail plus the
 * profit gate:
 *
 * 1. VOLATILITY_TARGET_EXIT — the first confirmed post-entry TOP (LONG) or
 *    BOTTOM (SHORT) closes THIS leg only, and only when the position's fee
 *    -adjusted net PnL is at or above `RAIL_EXIT_MIN_NET_PCT`. An
 *    underwater rail stays pending (it remains the earliest target, so the
 *    leg exits on the first later pass that turns profitable, or via the
 *    shared stops/rescue rules).
 * 2. The shared evaluator — traditional TP% and Stop-Loss+ stay disabled
 *    for pair legs (rail exits lead) until the exception condition: a
 *    favorable distance ≥ VOLATILITY_THRESHOLD from the latest vPoint
 *    re-enables them. All other exits (hard SL, USDT SL, level drift,
 *    post-average, rescue, volatility-target SL) run unchanged as OR
 *    conditions — these bound the loss of a held underwater leg.
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
  if (
    target &&
    (position.pnl.netPct ?? -Number.POSITIVE_INFINITY) >= RAIL_EXIT_MIN_NET_PCT
  ) {
    return close.force(
      context,
      position,
      "VOLATILITY_TARGET_EXIT",
      `[SELL] STREAK:VOLATILITY_TARGET_EXIT — favorable rail reached at ` +
        `${target.l}[${target.lvl}] price ${target.p} (net ` +
        `${(position.pnl.netPct ?? 0).toFixed(2)}% >= gate ${RAIL_EXIT_MIN_NET_PCT}%)`,
      { pairId: meta.pairId },
    );
  }

  const lastPoint = points.at(-1);
  const tpReenabled =
    favorableDistancePct({
      currentPrice: context.state.markPriceMap[symbol]?.price,
      direction: position.direction,
      lastVolatilityPrice: lastPoint?.p,
    }) >= VOLATILITY_THRESHOLD;

  return tradingExit.findDecision(context, position, {
    config: tpReenabled
      ? undefined
      : {
          takeProfitPercent: Number.POSITIVE_INFINITY,
          useStopLossPlus: false,
        },
  });
}

const profitRailExit = {
  find,
} as const;

export default profitRailExit;
