import type {
  RuntimeAveragingDecision,
  RuntimeContext,
} from "@/lib/precision/types";
import type { RuntimeAccountTradingConfig } from "../runtime";
import type {
  AveragingRecommendation,
  BalanceSummary,
  Position,
  PositionReserveStep,
} from "./types";
import { TradingMode } from "@/lib/exchange/types";
import { resolveVolatilityThreshold } from "../constants";
import type { VolatilityPoint } from "../types";

import reserve from "./reserve";

/** Generates averaging recommendations from the current watch state. */
function generateRecommendations(params: {
  activePositions: Position[];
  volatilityPointsMap: Record<string, VolatilityPoint[]>;
  config: RuntimeAccountTradingConfig;
  currentTimeMs?: number;
  quoteAsset?: number;
  reservedQuoteAsset?: number;
  /**
   * BOTH:LOW_LEVEL_NEXT_ADVERSE_AVERAGING — pair strategies opt in to relax
   * the entry-depth observation gate (`|lvl| > |entry lvl|`):
   *
   * - `"lowLevel"` admits the exact next adverse watch step at level ±1 —
   *   the `both` spec's relaxation.
   * - `"adverse"` admits any adverse-side point regardless of level
   *   (BOTTOM for LONG, TOP for SHORT), including level 0 — the `streak`
   *   rail design, where the direction-based target owns exits so an
   *   adverse level-0 point is an averaging step, not an exit.
   *
   * Only the observation gate relaxes; the deeper-than-next-step check
   * still prevents level skips.
   */
  levelGate?: "lowLevel" | "adverse";
}) {
  // BOTH:WATCH_MECHANISM
  // A. Normalize runtime input for the averaging scan.
  const {
    activePositions,
    volatilityPointsMap,
    config,
    currentTimeMs,
  } = params;
  const recommendations: AveragingRecommendation[] = [];
  const maxNextLevels = config.watchMaxNextAveragingLevels ?? 2;

  // B. Scan each active position against its latest volatility point.
  for (const position of activePositions) {
    if (!position.symbol) continue;

    const points = volatilityPointsMap[position.symbol];
    if (!points || points.length === 0) continue;

    const lastPoint = points.at(-1)!;
    // B.1 In backtest, only consume the volatility point for the current candle.
    if (
      typeof currentTimeMs === "number" &&
      Number.isFinite(currentTimeMs) &&
      lastPoint.t !== currentTimeMs
    ) {
      continue;
    }

    // Use the actual position margin as base — maxEntryMargin cap is handled by executeEntry
    const baseMargin = position.exposure.marginUsdt ?? 0;
    if (baseMargin <= 0) continue;

    // C. Resolve the next watch step that this position is allowed to consume.
    const entryLevel = position.opened.vPoint.lvl ?? 0;
    const nextStep = reserve.averaging.getNextWatchStep({
      averaging: position.strategy.averaging,
      includeUnreserved: true,
    });

    if (!nextStep) {
      continue;
    }

    const direction = position.direction || "LONG";
    const levelGate = params.levelGate;
    const isActionable =
      reserve.vpoints.isActionableAveragingLevel(lastPoint, entryLevel) ||
      (levelGate === "lowLevel" && Math.abs(lastPoint.lvl) === 1) ||
      (levelGate === "adverse" &&
        lastPoint.l === (direction === "LONG" ? "B" : "T"));

    // Check if we should recommend an averaging entry
    if (maxNextLevels > 0 && isActionable) {

      // D. Do not restart averaging after the first post-entry target vPoint.
      if (
        reserve.vpoints.hasPositionHitTargetPoint({
          position,
          volatilityPoints: points,
        })
      ) {
        continue;
      }

      // E. Emit an averaging recommendation only when the new point is deeper.
      // For LONG: average down when price drops through the next reserved level.
      const isDeeperLong =
        direction === "LONG" &&
        lastPoint.lvl < entryLevel &&
        lastPoint.lvl <= nextStep.level;
      // For SHORT: average up when price rises through the next reserved level.
      const isDeeperShort =
        direction === "SHORT" &&
        lastPoint.lvl > entryLevel &&
        lastPoint.lvl >= nextStep.level;

      if (isDeeperLong || isDeeperShort) {
        const distance = Math.abs(lastPoint.lvl - entryLevel);

        if (distance <= maxNextLevels) {
          recommendations.push({
            ...lastPoint,
            // Compact backtest vPoints omit runtime-only ownership metadata.
            // The active position remains the source of truth in every mode.
            symbol: position.symbol,
            message: `Averaging ${direction} for ${position.symbol} at level ${lastPoint.lvl}`,
            maxLeverage: position.exposure.leverage ?? 1,
            investAmount: nextStep.marginUsdt,
          });
        }
      }
    }
  }

  return {
    recommendations,
  };
}

/**
 * Finds the averaging decision for one open position, matching the legacy
 * scan. `options.levelGate` relaxes the entry-depth observation gate
 * (`|lvl| > |entry lvl|`) for verified pair legs — `"lowLevel"` admits the
 * exact next adverse ±1 step
 * (`both`), `"adverse"` admits any adverse-side point including level 0
 * (`streak` rail averaging). Ordinary one-way behavior stays unchanged.
 */
async function findDecision(
  context: RuntimeContext,
  position: Position,
  options?: { levelGate?: "lowLevel" | "adverse" },
): Promise<RuntimeAveragingDecision | null> {
  const accountConfig = context.helper.getAccountConfig(position.account);
  const balance = context.helper.getAccountBalance(position.account);
  const config: RuntimeAccountTradingConfig = {
    ...context.state.config.management,
    ...accountConfig,
  };
  const result = generateRecommendations({
    activePositions: [position],
    levelGate: options?.levelGate,
    config,
    quoteAsset: balance.available,
    reservedQuoteAsset: balance.reserved,
    volatilityPointsMap: context.state.vPointsMap,
  });
  const recommendation = result.recommendations.find(
    (candidate) =>
      String(candidate.symbol || "").toUpperCase() ===
      position.symbol.toUpperCase(),
  );
  if (!recommendation) return null;

  return {
    accountSlug: position.account,
    message: recommendation.message,
    position,
    recommendation,
    symbol: position.symbol.toUpperCase(),
    type: "averaging",
    vPointUsage: [position.account],
  };
}

type AveragingExecutionConfig = RuntimeAccountTradingConfig & {
  tradingMode?: TradingMode;
};

function getMark(
  context: RuntimeContext,
  symbol: string,
): { price: number; lastUpdated: number } | null {
  const mark = context.state.markPriceMap[symbol.toUpperCase()];
  if (
    !mark ||
    !Number.isFinite(mark.price) ||
    mark.price <= 0 ||
    !Number.isFinite(mark.lastUpdated)
  ) {
    return null;
  }

  return mark;
}

function getEffectiveConfig(
  context: RuntimeContext,
  accountSlug: string,
): AveragingExecutionConfig {
  return {
    ...context.state.config.management,
    ...context.helper.getAccountConfig(accountSlug),
  };
}

function getSpendableBalance(context: RuntimeContext, accountSlug: string) {
  const balance: BalanceSummary =
    context.helper.getAccountBalance(accountSlug);
  const spendable = Number.isFinite(balance.spendable)
    ? balance.spendable
    : balance.available - balance.reserved - balance.safeHaven;

  return {
    balance,
    spendable: Math.max(0, spendable),
  };
}

function getFeeRate(
  context: RuntimeContext,
  config: AveragingExecutionConfig,
  side: "buy" | "sell",
): number {
  return Math.max(
    0,
    context.adapter.exchange.getFeeRate({
      side,
      type: config.orderType ?? "taker",
    }),
  );
}

/** Everything needed to fill an approved averaging decision, in any mode. */
export interface AveragingPlan {
  adaptiveEnabled: boolean;
  config: AveragingExecutionConfig;
  feeRate: number;
  leverage: number;
  markPrice: number;
  nextStep: PositionReserveStep;
  position: Position;
  preferredQuantity: number;
  rescueProjection: ReturnType<
    typeof reserve.averaging.resolveRescueProjection
  >;
  spendStep: PositionReserveStep;
}

/** An executed averaging fill: mark-priced in simulation, exchange-priced live. */
export interface AveragingFill {
  price: number;
  quantity: number;
  t: number;
}

/** A planned averaging attempt — when `plan` is null, `blockReason` names the guard that refused it. */
export interface AveragingPlanAttempt {
  blockReason?: string;
  plan: AveragingPlan | null;
}

/** The averaging fill result — simulated or live — plus the refusal reason when no position is produced. */
export interface AveragingExecutionResult {
  blockReason?: string;
  position: Position | null;
}

const RESCUE_REFUSAL_REASONS: Record<string, string> = {
  DOES_NOT_IMPROVE_ENTRY: "the fill price does not improve the average entry",
  INSUFFICIENT_BALANCE: "the balance cannot cover the required step margin",
  INVALID_INPUT: "the averaging plan inputs are invalid",
  PROJECTED_PROFIT_BELOW_TARGET:
    "projected profit is below the adaptive target",
};

/**
 * Resolves the averaging spend for an approved decision without mutating the
 * position. A refused plan returns `blockReason` instead of a silent null so
 * callers can surface why an approved averaging produced no order — the
 * reason is also stamped on the position's next step (`attemptMessage`) so
 * the refusal survives on the persisted position record.
 */
function planAttempt(
  context: RuntimeContext,
  decision: RuntimeAveragingDecision,
): AveragingPlanAttempt {
  const symbol = decision.symbol.toUpperCase();
  // Resolve the intended step on the decision's own position (not the clone)
  // so a refusal can be written back where the engine persists it.
  const nextStep = reserve.averaging.getNextWatchStep({
    averaging: decision.position.strategy.averaging,
    includeUnreserved: true,
  });
  const fail = (blockReason: string): AveragingPlanAttempt => {
    if (nextStep) {
      nextStep.attemptMessage = blockReason;
      nextStep.attemptedAt = context.state.currentTime;
    }
    return { blockReason, plan: null };
  };
  if (!nextStep) {
    return fail(
      `No remaining averaging step for ${symbol}; every reserved step ` +
        "is already used.",
    );
  }

  const mark = getMark(context, symbol);
  if (!mark) {
    return fail(`No valid mark price for ${symbol}; averaging skipped.`);
  }

  const position = structuredClone(decision.position);
  const config = getEffectiveConfig(context, decision.accountSlug);
  const { balance, spendable } = getSpendableBalance(
    context,
    decision.accountSlug,
  );

  const rescueProjection = reserve.averaging.resolveRescueProjection({
    position,
    step: nextStep,
    executablePrice: mark.price,
    rescueAnchorPrice: decision.recommendation.p,
    quoteAsset: balance.available,
    reservedQuoteAsset: balance.reserved,
    adaptiveAveraging: config.adaptiveAveraging,
    rescueProjectionGuardEnabled:
      config.averagingRescueProjectionGuardEnabled !== false,
    triggerVolatilityPct: decision.recommendation.pct,
    volatilityThresholdPct: resolveVolatilityThreshold(
      context.state.config.management,
    ),
  });
  if (!rescueProjection.canExecute) {
    const detail =
      RESCUE_REFUSAL_REASONS[rescueProjection.reason] ??
      rescueProjection.reason;
    return fail(
      `Averaging guard refused ${symbol}: ${detail} ` +
        `(level ${nextStep.level} step, $${rescueProjection.marginUsdt.toFixed(2)} margin).`,
    );
  }

  const marginUsdt = rescueProjection.marginUsdt;
  const minimalUsdt = reserve.constants.minimalUsdtToTrade;
  if (marginUsdt < minimalUsdt) {
    return fail(
      `Averaging margin $${marginUsdt.toFixed(2)} for ${symbol} is below ` +
        `the $${minimalUsdt.toFixed(2)} minimum order size.`,
    );
  }

  const spendStep: PositionReserveStep = {
    ...nextStep,
    allocationPct: rescueProjection.multiplier,
    marginUsdt,
    reservedMarginUsdt: nextStep.marginUsdt,
  };
  if (
    !reserve.averaging.canSpendWatchStepMargin({
      step: spendStep,
      quoteAsset: balance.available,
      reservedQuoteAsset: balance.reserved,
      minimalUsdt,
    })
  ) {
    return fail(
      `Insufficient spendable balance for the ${symbol} averaging step: ` +
        `needs $${marginUsdt.toFixed(2)}, spendable ` +
        `$${spendable.toFixed(2)}.`,
    );
  }

  const leverage = Math.max(1, position.exposure.leverage || 1);
  const notionalUsdt =
    config.tradingMode === TradingMode.SPOT ? marginUsdt : marginUsdt * leverage;
  const preferredQuantity = notionalUsdt / mark.price;
  if (!Number.isFinite(preferredQuantity) || preferredQuantity <= 0) {
    return fail(
      `Computed a non-positive averaging quantity for ${symbol} at ` +
        `$${mark.price}.`,
    );
  }

  const feeRate = getFeeRate(context, config, "buy");
  const feeUsdt = notionalUsdt * feeRate;
  const nextQuantity = position.exposure.quantity + preferredQuantity;
  if (!Number.isFinite(nextQuantity) || nextQuantity <= 0) {
    return fail(
      `Computed an invalid resulting quantity for ${symbol} averaging.`,
    );
  }
  if (marginUsdt + feeUsdt > balance.available) {
    return fail(
      `Averaging cost $${(marginUsdt + feeUsdt).toFixed(2)} (margin + fee) ` +
        `exceeds the $${balance.available.toFixed(2)} available balance ` +
        `for ${symbol}.`,
    );
  }

  return {
    plan: {
      adaptiveEnabled: config.adaptiveAveraging?.enabled === true,
      config,
      feeRate,
      leverage,
      markPrice: mark.price,
      nextStep,
      position,
      preferredQuantity,
      rescueProjection,
      spendStep,
    },
  };
}

/**
 * Applies an executed averaging fill to the plan's cloned position. Margin,
 * fees, and reserve consumption are derived from the actual filled price and
 * quantity — identical math for simulated and exchange fills.
 */
function applyFill(
  plan: AveragingPlan,
  fill: AveragingFill,
): Position | null {
  if (
    !Number.isFinite(fill.price) ||
    fill.price <= 0 ||
    !Number.isFinite(fill.quantity) ||
    fill.quantity <= 0
  ) {
    return null;
  }

  const fillNotionalUsdt = fill.price * fill.quantity;
  const fillMarginUsdt =
    plan.config.tradingMode === TradingMode.SPOT
      ? fillNotionalUsdt
      : fillNotionalUsdt / plan.leverage;
  const fillFeeUsdt = fillNotionalUsdt * plan.feeRate;

  const position = plan.position;
  const nextQuantity = position.exposure.quantity + fill.quantity;
  position.exposure.averageEntryPrice =
    (position.exposure.averageEntryPrice * position.exposure.quantity +
      fill.price * fill.quantity) /
    nextQuantity;
  position.exposure.quantity = nextQuantity;
  position.exposure.notionalUsdt += fillNotionalUsdt;
  position.exposure.marginUsdt += fillMarginUsdt;
  position.fees.entryUsdt += fillFeeUsdt;
  position.fees.estimatedExitUsdt =
    position.exposure.notionalUsdt * plan.feeRate;
  position.strategy.averaging.executions ??= [];
  position.strategy.averaging.executions.push({
    t: fill.t,
    level: plan.nextStep.level,
    marginUsdt: fillMarginUsdt,
    price: fill.price,
    allocationPct: plan.rescueProjection.multiplier,
    reservedMarginUsdt: plan.nextStep.marginUsdt,
    // BOTH:ADAPTIVE_AVERAGING
    adaptiveMultiplier: plan.adaptiveEnabled
      ? plan.rescueProjection.multiplier
      : undefined,
    projectedProfitPct: plan.adaptiveEnabled
      ? plan.rescueProjection.projectedProfitPct
      : undefined,
    // BOTH:AVERAGING_MONITORING_STATE_SNAPSHOT
    monitoringState: position.lastMonitoringStage
      ? { ...position.lastMonitoringStage }
      : undefined,
  });
  reserve.averaging.markReservedStepUsed({
    averaging: position.strategy.averaging,
    handledLevel: plan.nextStep.level,
    executedPrice: fill.price,
    usedAt: fill.t,
    usedMarginUsdt: fillMarginUsdt,
    usedPctAlloc: plan.rescueProjection.multiplier,
  });

  return position;
}

/**
 * Executes a simulated averaging fill like `execute`, also reporting which
 * guard refused the step when no position is produced.
 */
function executeWithReason(
  context: RuntimeContext,
  decision: RuntimeAveragingDecision,
): AveragingExecutionResult {
  const attempt = planAttempt(context, decision);
  if (!attempt.plan) {
    return { blockReason: attempt.blockReason, position: null };
  }

  const position = applyFill(attempt.plan, {
    price: attempt.plan.markPrice,
    quantity: attempt.plan.preferredQuantity,
    t: context.state.currentTime,
  });

  return {
    blockReason: position
      ? undefined
      : `Executed averaging fill for ${decision.symbol.toUpperCase()} ` +
        "produced an invalid position.",
    position,
  };
}

/** Executes a simulated averaging fill on a cloned position. */
function execute(
  context: RuntimeContext,
  decision: RuntimeAveragingDecision,
): Position | null {
  return executeWithReason(context, decision).position;
}

/** Resolves the averaging plan; null when a guard refuses the step. */
function buildPlan(
  context: RuntimeContext,
  decision: RuntimeAveragingDecision,
): AveragingPlan | null {
  return planAttempt(context, decision).plan;
}

const averaging = {
  applyFill,
  execute,
  executeWithReason,
  findDecision,
  plan: buildPlan,
  planAttempt,
} as const;

export default averaging;
