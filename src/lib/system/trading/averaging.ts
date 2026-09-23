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

    // Check if we should recommend an averaging entry
    if (
      maxNextLevels > 0 &&
      reserve.vpoints.isActionableAveragingLevel(lastPoint)
    ) {
      const direction = position.direction || "LONG";

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

/** Finds the averaging decision for one open position, matching the legacy scan. */
async function findDecision(
  context: RuntimeContext,
  position: Position,
): Promise<RuntimeAveragingDecision | null> {
  const accountConfig = context.helper.getAccountConfig(position.account);
  const balance = context.helper.getAccountBalance(position.account);
  const config: RuntimeAccountTradingConfig = {
    ...context.state.config.management,
    ...accountConfig,
  };
  const result = generateRecommendations({
    activePositions: [position],
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

/**
 * Resolves the averaging spend for an approved decision without mutating the
 * position. The returned plan carries a cloned position the fill is applied to.
 */
function buildPlan(
  context: RuntimeContext,
  decision: RuntimeAveragingDecision,
): AveragingPlan | null {
  const symbol = decision.symbol.toUpperCase();
  const mark = getMark(context, symbol);
  if (!mark) return null;

  const position = structuredClone(decision.position);
  const config = getEffectiveConfig(context, decision.accountSlug);
  const { balance } = getSpendableBalance(context, decision.accountSlug);
  const nextStep = reserve.averaging.getNextWatchStep({
    averaging: position.strategy.averaging,
    includeUnreserved: true,
  });
  if (!nextStep) return null;

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
  });
  if (!rescueProjection.canExecute) return null;

  const marginUsdt = rescueProjection.marginUsdt;
  if (marginUsdt < reserve.constants.minimalUsdtToTrade) return null;

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
      minimalUsdt: reserve.constants.minimalUsdtToTrade,
    })
  ) {
    return null;
  }

  const leverage = Math.max(1, position.exposure.leverage || 1);
  const notionalUsdt =
    config.tradingMode === TradingMode.SPOT ? marginUsdt : marginUsdt * leverage;
  const preferredQuantity = notionalUsdt / mark.price;
  if (!Number.isFinite(preferredQuantity) || preferredQuantity <= 0) {
    return null;
  }

  const feeRate = getFeeRate(context, config, "buy");
  const feeUsdt = notionalUsdt * feeRate;
  const nextQuantity = position.exposure.quantity + preferredQuantity;
  if (
    !Number.isFinite(nextQuantity) ||
    nextQuantity <= 0 ||
    marginUsdt + feeUsdt > balance.available
  ) {
    return null;
  }

  return {
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

/** Executes a simulated averaging fill on a cloned position. */
function execute(
  context: RuntimeContext,
  decision: RuntimeAveragingDecision,
): Position | null {
  const averagingPlan = buildPlan(context, decision);
  if (!averagingPlan) return null;

  return applyFill(averagingPlan, {
    price: averagingPlan.markPrice,
    quantity: averagingPlan.preferredQuantity,
    t: context.state.currentTime,
  });
}

const averaging = {
  applyFill,
  execute,
  findDecision,
  plan: buildPlan,
} as const;

export default averaging;
