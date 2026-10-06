import tradingExit from "@/lib/system/trading/exit";
import reserve from "@/lib/system/trading/reserve";
import type { Position } from "@/lib/system/trading";
import type {
  RuntimeContext,
  RuntimeExitDecision,
} from "@/lib/precision/types";

import close from "../shared/close";
import pair from "../shared/pair";

/**
 * `streak_with_feature_gate` exit producer — streak's favorable rail plus
 * the FULL shared TP rule set:
 *
 * 1. STREAK:VOLATILITY_TARGET_EXIT — the first confirmed post-entry TOP
 *    (LONG) or BOTTOM (SHORT) closes THIS leg only, same as `streak`.
 * 2. The shared evaluator runs with the account config untouched —
 *    unlike `streak`, this variant never parks `takeProfitPercent` /
 *    `useStopLossPlus` on pair legs, so TP%/SL+ trail from the first
 *    profitable float instead of waiting for a ≥ VOLATILITY_THRESHOLD
 *    exception. Hard stops and the post-average rules are unchanged.
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

  // Same anchor exclusion as streak — a leg opened on a same-label point
  // must not close on its own anchor and loop close/reopen.
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

  return tradingExit.findDecision(context, position);
}

const streakGateExit = {
  find,
} as const;

export default streakGateExit;
