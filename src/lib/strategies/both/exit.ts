import tradingExit from "@/lib/system/trading/exit";
import type { ExitEvaluationConfig } from "@/lib/system/trading/exit";
import type { Position } from "@/lib/system/trading";
import type { VolatilityPoint } from "@/lib/system/types";
import type {
  RuntimeContext,
  RuntimeExitDecision,
} from "@/lib/precision/types";

import close from "../shared/close";
import pair from "../shared/pair";
import type { PairLegMeta } from "../shared/pair";
import bothState from "./state";

/**
 * BOTH:VOLATILITY_TARGET_EXIT — the armed→level-0 target. An entry whose
 * vPoint has a non-zero level is already armed: the first later level-0
 * point is the target. A level-0 entry arms on the first later non-zero
 * level, and the next level-0 point after it is the target. Direction-
 * agnostic; the entry vPoint itself can never be the target.
 */
function findArmedTargetPoint(
  position: Position,
  points: VolatilityPoint[],
): VolatilityPoint | undefined {
  const entryT = position.opened.t;
  let armed = (position.opened.vPoint.lvl ?? 0) !== 0;
  for (const point of points) {
    if (point.t < entryT) continue;
    if (point.id === position.opened.vPoint.id) continue;
    if (!armed) {
      if (point.lvl !== 0) armed = true;
      continue;
    }
    if (point.lvl === 0) return point;
  }
  return undefined;
}

/**
 * PROD:REENABLE_TP_LOGIC_AFTER_AT_LEAST_ONE_LEVEL_TO_PROFIT_DIRECTION_PASSED_AND_OTHER_SIDE_WAS_CLOSED
 * — true when the pair's MAIN leg is gone (closed or never opened under a
 * `COUNTER`-only `entryLegs`) and at least one post-entry vPoint moved one
 * or more levels toward this leg's profit side.
 */
function hasProfitLevelPassed(
  context: RuntimeContext,
  position: Position,
): boolean {
  const points =
    context.state.vPointsMap[position.symbol.toUpperCase()] ?? [];
  const profitLabel = position.direction === "LONG" ? "T" : "B";
  const entryLevel = position.opened.vPoint.lvl ?? 0;
  return points.some(
    (point) =>
      point.t >= position.opened.t &&
      point.id !== position.opened.vPoint.id &&
      point.l === profitLabel &&
      (position.direction === "LONG"
        ? point.lvl - entryLevel >= 1
        : entryLevel - point.lvl >= 1),
  );
}

/**
 * Counter-leg exit overlay: ordinary percentage TP and Stop-Loss+ stay
 * disabled (structural volatility exits lead) until the re-enable
 * condition — MAIN counterpart gone AND a profit-side level passed — is
 * met, after which the counter evaluates the full default rule set.
 */
function counterOverrides(
  context: RuntimeContext,
  position: Position,
  meta: PairLegMeta,
): Partial<ExitEvaluationConfig> | undefined {
  if (pair.findSibling(context, meta) === undefined &&
      hasProfitLevelPassed(context, position)) {
    return undefined;
  }
  return {
    takeProfitPercent: Number.POSITIVE_INFINITY,
    useStopLossPlus: false,
  };
}

/**
 * `both` exit producer — three sources in precedence order:
 *
 * 1. `pendingClose` — a sibling's cascading close (stop-loss family or the
 *    pair target) drains into this leg's forced exit, keeping the
 *    originating reason (`BOTH:EXIT_TOGETHER_WHEN_STOP_LOSS`).
 * 2. `BOTH:VOLATILITY_TARGET_EXIT` — the armed→level-0 target; the
 *    strategy bookkeeping marks the sibling pending on success.
 * 3. The shared evaluator — full rule set for MAIN; counter legs run it
 *    under the TP%/SL+ overrides until the re-enable condition holds.
 */
async function find(
  context: RuntimeContext,
  position: Position,
): Promise<RuntimeExitDecision | null> {
  const meta = pair.meta.ofPosition(position);
  if (!meta) {
    // A position without pair meta (manual entry, pre-strategy data) keeps
    // the plain default pipeline.
    return tradingExit.findDecision(context, position);
  }

  const state = bothState.read(context);
  const pending = state.pendingClose[meta.pairId];
  if (pending) {
    return close.force(context, position, pending.reason, pending.message, {
      pairId: meta.pairId,
      coordinated: true,
    });
  }

  const points =
    context.state.vPointsMap[position.symbol.toUpperCase()] ?? [];
  const target = findArmedTargetPoint(position, points);
  if (target) {
    return close.force(
      context,
      position,
      "VOLATILITY_TARGET_EXIT",
      `[SELL] BOTH:VOLATILITY_TARGET_EXIT — volatility target reached at ` +
        `${target.l}[${target.lvl}] price ${target.p}`,
      { pairId: meta.pairId },
    );
  }

  return tradingExit.findDecision(context, position, {
    config:
      meta.role === "COUNTER"
        ? counterOverrides(context, position, meta)
        : undefined,
  });
}

const bothExit = {
  find,
} as const;

export default bothExit;
