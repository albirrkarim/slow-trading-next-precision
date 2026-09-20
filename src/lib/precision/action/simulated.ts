import { TradingMode } from "@/lib/exchange";
import { getFeeCalculator } from "@/lib/exchange/fees";
import type { DynamicTradeConfig } from "@/lib/dynamic";
import slowTradingWatchReserve from "@/lib/slowTrading/watch-reserve";
import entryFunding from "@/lib/trading/execute/entry-funding";
import { resolveEntryLeverage } from "@/lib/trading/execute/entry-leverage";
import type {
  Position,
  PositionAveragingState,
  PositionReserveStep,
} from "@/lib/trading/models";
import { MINIMAL_USDT_TO_TRADE } from "@/lib/trading/constants";

import type {
  RuntimeAveragingDecision,
  RuntimeContext,
  RuntimeDecision,
  RuntimeEntryDecision,
  RuntimeExitDecision,
} from "../types";

interface RuntimeMark {
  price: number;
  lastUpdated: number;
}

function getMark(context: RuntimeContext, symbol: string): RuntimeMark | null {
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
): DynamicTradeConfig {
  return {
    ...context.state.config.management,
    ...context.helper.getAccountConfig(accountSlug),
  };
}

function getFeeRate(
  config: DynamicTradeConfig,
  side: "buy" | "sell",
): number {
  const feePercent = getFeeCalculator(config.exchangeType).getTotalFeePercent({
    currency: "USDT",
    side,
    type: config.orderType ?? "taker",
  });

  return Math.max(0, feePercent / 100);
}

function getSpendableBalance(context: RuntimeContext, accountSlug: string) {
  const balance = context.helper.getAccountBalance(accountSlug);
  const spendable = Number.isFinite(balance.spendable)
    ? balance.spendable
    : balance.available - balance.reserved - balance.safeHaven;

  return {
    balance,
    spendable: Math.max(0, spendable),
  };
}

function createEmptyAveragingState(
  entryLevel: number,
): PositionAveragingState {
  return {
    entryLevel,
    lastHandledLevel: entryLevel,
    reserveBaseMarginUsdt: 0,
    reservedRemainingMarginUsdt: 0,
    steps: [],
  };
}

function cloneValue<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}

function resolveRequestedEntryMargin(
  decision: RuntimeEntryDecision,
  spendableUsdt: number,
): number {
  const signal = decision.entrySignal;
  const configuredMargin = Number(signal.investAmount);

  // An already-resolved recommendation is a margin amount, not a probability
  // budget. This is how the dynamic/backtest recommendation contract defines it.
  if (Number.isFinite(configuredMargin) && configuredMargin > 0) {
    return signal.maxUsdtEntry && signal.maxUsdtEntry > 0
      ? Math.min(configuredMargin, signal.maxUsdtEntry)
      : configuredMargin;
  }

  const probability = Number(signal.amountProbab);
  const allocation =
    Number.isFinite(probability) && probability > 0
      ? Math.min(1, probability)
      : 0;
  const runtimeBudget = Math.max(0, spendableUsdt);
  const requestedMargin = Math.floor(runtimeBudget * allocation);

  return signal.maxUsdtEntry && signal.maxUsdtEntry > 0
    ? Math.min(requestedMargin, signal.maxUsdtEntry)
    : requestedMargin;
}

function buildEntryPosition(
  context: RuntimeContext,
  decision: RuntimeEntryDecision,
): Position | null {
  const symbol = decision.symbol.toUpperCase();
  const mark = getMark(context, symbol);
  if (!mark) return null;

  const config = getEffectiveConfig(context, decision.accountSlug);
  const { balance, spendable } = getSpendableBalance(
    context,
    decision.accountSlug,
  );
  const signal = decision.entrySignal;
  const leverage = resolveEntryLeverage({
    config,
    entrySignal: signal,
    tradingMode: config.tradingMode,
  });
  const feeRate = getFeeRate(config, "buy");
  const requestedMarginUsdt = resolveRequestedEntryMargin(
    decision,
    spendable,
  );
  if (requestedMarginUsdt <= 0) return null;

  const direction = decision.direction;
  const activePositions = context.state.openPositions.filter(
    (position) =>
      position.account === decision.accountSlug && !position.closed,
  );
  const fundingPlan = entryFunding.plan.calculate({
    activePositions,
    config,
    direction,
    entryLevel: signal.lvl ?? 0,
    feeRate,
    leverage,
    requestedMarginUsdt,
    reservedQuoteAsset: balance.reserved,
    spendableQuoteAsset: Math.max(0, balance.available - balance.safeHaven),
    tradingMode: config.tradingMode,
  });

  if (
    fundingPlan.blockCode ||
    fundingPlan.estimatedMarginUsdt < MINIMAL_USDT_TO_TRADE ||
    fundingPlan.estimatedMarginUsdt +
        fundingPlan.estimatedFeeUsdt +
        fundingPlan.reserveBudgetUsdt >
      fundingPlan.spendableUsdt
  ) {
    return null;
  }

  const marginUsdt = fundingPlan.estimatedMarginUsdt;
  const notionalUsdt = fundingPlan.adjustedNotionalUsdt;
  const averaging =
    fundingPlan.projectedWatchState ??
    createEmptyAveragingState(signal.lvl ?? 0);

  return {
    account: decision.accountSlug,
    symbol,
    executionMode: "sandbox",
    tradingMode: config.tradingMode,
    direction,
    opened: {
      t: context.state.currentTime,
      vPoint: { id: signal.id, lvl: signal.lvl ?? 0 },
      reason: "COMMON",
      message: decision.message,
      price: mark.price,
    },
    exposure: {
      averageEntryPrice: mark.price,
      quantity: notionalUsdt / mark.price,
      notionalUsdt,
      marginUsdt,
      leverage,
    },
    fees: {
      entryUsdt: fundingPlan.estimatedFeeUsdt,
      estimatedExitUsdt: notionalUsdt * getFeeRate(config, "sell"),
    },
    strategy: {
      entry: {
        engine: config.decisionEngineVersion,
        feature: cloneValue(signal.feature),
        label: signal.descisionLabel,
      },
      averaging,
    },
    pnl: {
      currentValueUsdt: marginUsdt,
      history: [{ t: context.state.currentTime, pct: 0 }],
      markPrice: mark.price,
      maxDownPct: 0,
      maxDownUsdt: 0,
      maxUpPct: 0,
      maxUpUsdt: 0,
      netPct: 0,
      netUsdt: 0,
    },
  };
}

function executeAveraging(
  context: RuntimeContext,
  decision: RuntimeAveragingDecision,
): Position | null {
  const symbol = decision.symbol.toUpperCase();
  const mark = getMark(context, symbol);
  if (!mark) return null;

  const position = structuredClone(decision.position);
  const config = getEffectiveConfig(context, decision.accountSlug);
  const { balance } = getSpendableBalance(context, decision.accountSlug);
  const nextStep = slowTradingWatchReserve.averaging.getNextStep({
    averaging: position.strategy.averaging,
    includeUnreserved: true,
  });
  if (!nextStep) return null;

  const rescueProjection =
    slowTradingWatchReserve.averaging.resolveRescueProjection({
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
  if (marginUsdt < MINIMAL_USDT_TO_TRADE) return null;

  const spendStep: PositionReserveStep = {
    ...nextStep,
    allocationPct: rescueProjection.multiplier,
    marginUsdt,
    reservedMarginUsdt: nextStep.marginUsdt,
  };
  if (
    !slowTradingWatchReserve.balance.canSpendWatchStepMargin({
      step: spendStep,
      quoteAsset: balance.available,
      reservedQuoteAsset: balance.reserved,
      minimalUsdt: MINIMAL_USDT_TO_TRADE,
    })
  ) {
    return null;
  }

  const leverage = Math.max(1, position.exposure.leverage || 1);
  const notionalUsdt =
    config.tradingMode === TradingMode.SPOT ? marginUsdt : marginUsdt * leverage;
  const quantity = notionalUsdt / mark.price;
  if (!Number.isFinite(quantity) || quantity <= 0) return null;

  const feeRate = getFeeRate(config, "buy");
  const feeUsdt = notionalUsdt * feeRate;
  const nextQuantity = position.exposure.quantity + quantity;
  if (
    !Number.isFinite(nextQuantity) ||
    nextQuantity <= 0 ||
    marginUsdt + feeUsdt > balance.available
  ) {
    return null;
  }

  const nextPosition = position;
  nextPosition.exposure.averageEntryPrice =
    (position.exposure.averageEntryPrice * position.exposure.quantity +
      mark.price * quantity) /
    nextQuantity;
  nextPosition.exposure.quantity = nextQuantity;
  nextPosition.exposure.notionalUsdt += notionalUsdt;
  nextPosition.exposure.marginUsdt += marginUsdt;
  nextPosition.fees.entryUsdt += feeUsdt;
  nextPosition.fees.estimatedExitUsdt =
    nextPosition.exposure.notionalUsdt * getFeeRate(config, "sell");
  nextPosition.strategy.averaging.executions ??= [];
  nextPosition.strategy.averaging.executions.push({
    t: context.state.currentTime,
    level: nextStep.level,
    marginUsdt,
    price: mark.price,
    allocationPct: rescueProjection.multiplier,
    reservedMarginUsdt: nextStep.marginUsdt,
    adaptiveMultiplier: config.adaptiveAveraging?.enabled
      ? rescueProjection.multiplier
      : undefined,
    projectedProfitPct: config.adaptiveAveraging?.enabled
      ? rescueProjection.projectedProfitPct
      : undefined,
    monitoringState: nextPosition.lastMonitoringStage
      ? { ...nextPosition.lastMonitoringStage }
      : undefined,
  });
  slowTradingWatchReserve.averaging.markReservedStepUsed({
    averaging: nextPosition.strategy.averaging,
    handledLevel: nextStep.level,
    executedPrice: mark.price,
    usedAt: context.state.currentTime,
    usedMarginUsdt: marginUsdt,
    usedPctAlloc: rescueProjection.multiplier,
  });

  return nextPosition;
}

function executeExit(decision: RuntimeExitDecision): Position | null {
  const closedPosition = decision.tradeDecision.position;
  if (!closedPosition?.closed) return null;

  return structuredClone(closedPosition);
}

async function execute(
  decision: RuntimeDecision,
  context: RuntimeContext,
): Promise<Position | null> {
  if (context.state.mode === "live") {
    throw new Error(
      "The simulated action adapter cannot execute live orders.",
    );
  }

  switch (decision.type) {
    case "entry":
      return buildEntryPosition(context, decision);
    case "averaging":
      return executeAveraging(context, decision);
    case "exit":
      return executeExit(decision);
    default:
      throw new Error("Unsupported runtime action.");
  }
}

const simulatedAction = { execute } as const;

export default simulatedAction;
