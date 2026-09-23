import type {
  RuntimeContext,
  RuntimeEntryDecision,
} from "@/lib/precision/types";
import type {
  RuntimeAccountTradingConfig,
  RuntimeManagementConfig,
} from "../runtime";
import { systemLog } from "../logging";
import format from "../utils/format";
import type {
  BalanceSummary,
  EntryRecommendation,
  Position,
  PositionAveragingState,
  PositionExecutionMode,
} from "./types";
import { TradingMode } from "@/lib/exchange/types";

import runtimeEntryLeverage from "./leverage";
import reserve from "./reserve";

const resolveEntryLeverage = runtimeEntryLeverage.resolve;

type EntryExecutionConfig = RuntimeAccountTradingConfig &
  RuntimeManagementConfig;

export interface EntryFundingPlan {
  adjustedNotionalUsdt: number;
  availableNotionalUsdt: number;
  bailoutBufferUsdt: number;
  blockCode?: string;
  blockReason?: string;
  estimatedFeeUsdt: number;
  estimatedMarginUsdt: number;
  marginRate: number;
  projectedWatchState?: PositionAveragingState;
  reserveBudgetUsdt: number;
  spendableAfterEntryUsdt: number;
  spendableUsdt: number;
  totalRequiredUsdt: number;
}

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
): EntryExecutionConfig {
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
  config: EntryExecutionConfig,
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

/**
 * Calculates the production entry funding plan without mutating balances.
 */
function calculateEntryFundingPlan(params: {
  activePositions: Array<Pick<Position, "strategy">>;
  config: RuntimeAccountTradingConfig;
  direction: "LONG" | "SHORT";
  entryLevel: number;
  feeRate: number;
  leverage: number;
  requestedMarginUsdt: number;
  reservedQuoteAsset: number;
  spendableQuoteAsset: number;
  tradingMode: TradingMode;
  volume24h?: number;
}): EntryFundingPlan {
  const feeRate = Number.isFinite(params.feeRate)
    ? Math.max(0, params.feeRate)
    : 0;
  const leverage = Math.max(
    1,
    Number.isFinite(params.leverage) ? params.leverage : 1,
  );
  const spendableUsdt = Math.max(
    0,
    params.spendableQuoteAsset - params.reservedQuoteAsset,
  );
  const watchEnabled = params.config.enableWatchLogic !== false;
  const reserveLevels = params.config.watchReserveLevels ?? 2;
  const pctAlloc = params.config.watchReservePctAlloc ?? 2;
  const marginRate =
    params.tradingMode === TradingMode.SPOT
      ? 1
      : (1 - feeRate) / leverage + feeRate;
  // BOTH:ADJUST_ENTRY_AMOUNT
  const adjustedMarginBudget =
    marginRate > 0
      ? reserve.entry.adjustMarginForConfig({
          desiredMarginUsdt: params.requestedMarginUsdt,
          spendableUsdt,
          enableWatchLogic: watchEnabled,
          entrySpareBufferEnabled:
            params.config.entrySpareBufferEnabled !== false,
          reserveLevels,
          pctAlloc,
          maxEntryBased24HourVolPct:
            params.config.maxEntryBased24HourVolPct ?? 0.2,
          volume24h: params.volume24h,
          maxEntryMarginPct: params.config.maxEntryMarginPct ?? 0,
          maxEntryMargin: params.config.maxEntryMargin ?? 0,
        })
      : 0;
  const adjustedNotionalUsdt =
    marginRate > 0 ? adjustedMarginBudget / marginRate : 0;
  const estimatedFeeUsdt = adjustedNotionalUsdt * feeRate;
  const availableNotionalUsdt =
    adjustedNotionalUsdt - estimatedFeeUsdt;
  const estimatedMarginUsdt =
    params.tradingMode === TradingMode.SPOT
      ? adjustedNotionalUsdt
      : availableNotionalUsdt / leverage + estimatedFeeUsdt;
  const projectedWatchState = watchEnabled
    ? reserve.state.build({
        direction: params.direction,
        baseMarginUsdt: estimatedMarginUsdt,
        entryLevel: params.entryLevel,
        reserveLevels,
        maxNextLevels:
          params.config.watchMaxNextAveragingLevels ?? reserveLevels,
        pctAlloc,
      })
    : undefined;
  const reserveBudgetUsdt = reserve.state.getReservedRemainingUsdt(
    projectedWatchState,
  );
  const totalRequiredUsdt = estimatedMarginUsdt + reserveBudgetUsdt;
  const bailoutGate =
    reserve.balance.canKeepSpendableForLargestUnreservedBailout({
      activePositions: params.activePositions,
      entryMarginUsdt: estimatedMarginUsdt,
      projectedWatchState,
      reserveBudgetUsdt,
      spendableUsdt,
    });

  let blockCode: string | undefined;
  let blockReason: string | undefined;
  if (adjustedMarginBudget < reserve.constants.minimalUsdtToTrade) {
    blockCode = "ENTRY_AMOUNT_TOO_SMALL";
    blockReason =
      "Entry margin too small " +
      `${adjustedMarginBudget.toFixed(2)} ` +
      `minimal ${reserve.constants.minimalUsdtToTrade.toFixed(2)}`;
  } else if (spendableUsdt < totalRequiredUsdt) {
    // BOTH:HAVE_ENOUGH_TO_RESERVED
    blockCode = "INSUFFICIENT_ENTRY_RESERVE";
    blockReason =
      "Not enough spendable balance to buy with reserve. " +
      `spendableUSDT:${spendableUsdt.toFixed(2)} ` +
      `entryMarginUSDT:${estimatedMarginUsdt.toFixed(2)} ` +
      `reserveBudgetUSDT:${reserveBudgetUsdt.toFixed(2)} ` +
      `totalRequiredUSDT:${totalRequiredUsdt.toFixed(2)} ` +
      `reservedUSDT:${params.reservedQuoteAsset.toFixed(2)}`;
  } else if (!bailoutGate.canEnter) {
    // BOTH:ALWAYS_HAVE_SPENDABLE_TO_BAILING_OUT
    blockCode = "INSUFFICIENT_BAILOUT_BUFFER";
    blockReason =
      "Not enough spendable balance to keep bailout buffer. " +
      `spendableUSDT:${spendableUsdt.toFixed(2)} ` +
      `entryMarginUSDT:${estimatedMarginUsdt.toFixed(2)} ` +
      `reserveBudgetUSDT:${reserveBudgetUsdt.toFixed(2)} ` +
      `spendableAfterEntryUSDT:${bailoutGate.spendableAfterEntryUsdt.toFixed(2)} ` +
      `largestUnreservedBailoutUSDT:${bailoutGate.largestUnreservedBailoutUsdt.toFixed(2)} ` +
      `reservedUSDT:${params.reservedQuoteAsset.toFixed(2)}`;
  }

  return {
    adjustedNotionalUsdt,
    availableNotionalUsdt,
    bailoutBufferUsdt: bailoutGate.largestUnreservedBailoutUsdt,
    blockCode,
    blockReason,
    estimatedFeeUsdt,
    estimatedMarginUsdt,
    marginRate,
    projectedWatchState,
    reserveBudgetUsdt,
    spendableAfterEntryUsdt: bailoutGate.spendableAfterEntryUsdt,
    spendableUsdt,
    totalRequiredUsdt,
  };
}

function createEmptyAveragingState(
  entryLevel: number,
  baseMarginUsdt: number,
): PositionAveragingState {
  return {
    entryLevel,
    lastHandledLevel: entryLevel,
    reserveBaseMarginUsdt: baseMarginUsdt,
    reservedRemainingMarginUsdt: 0,
    steps: [],
  };
}

/** Normalizes the persisted entry feature exactly like the legacy executor. */
function normalizeEntryFeature(
  feature: EntryRecommendation["feature"],
): Record<string, unknown> | undefined {
  const cloned =
    feature && typeof feature === "object"
      ? (cloneValue(feature) as Record<string, unknown>)
      : {};
  return Object.keys(cloned).length > 0 ? cloned : undefined;
}

/** Everything needed to fill an approved entry decision, in any mode. */
export interface EntryPlan {
  config: EntryExecutionConfig;
  direction: "LONG" | "SHORT";
  entryLevel: number;
  feeRate: number;
  fundingPlan: EntryFundingPlan;
  leverage: number;
  markPrice: number;
  preferredQuantity: number;
  signal: EntryRecommendation;
  watch: {
    enabled: boolean;
    maxNextLevels: number;
    pctAlloc: number;
    reserveLevels: number;
  };
}

/** An executed entry fill: mark-priced in simulation, exchange-priced live. */
export interface EntryFill {
  executionMode: PositionExecutionMode;
  message?: string;
  price: number;
  quantity: number;
  t: number;
}

/**
 * Computes the entry funding plan for an approved decision without executing.
 * Both simulated fills and live order placement share this plan.
 */
function buildPlan(
  context: RuntimeContext,
  decision: RuntimeEntryDecision,
): EntryPlan | null {
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
  const feeRate = getFeeRate(context, config, "buy");
  const requestedMarginUsdt = resolveRequestedEntryMargin(decision, spendable);
  if (requestedMarginUsdt <= 0) return null;

  const direction = decision.direction;
  const activePositions = context.state.openPositions.filter(
    (position) => position.account === decision.accountSlug && !position.closed,
  );
  const fundingPlan = calculateEntryFundingPlan({
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
    volume24h: context.state.volume24hMap?.[symbol],
  });

  if (
    fundingPlan.blockCode ||
    fundingPlan.estimatedMarginUsdt < reserve.constants.minimalUsdtToTrade ||
    fundingPlan.estimatedMarginUsdt +
      fundingPlan.estimatedFeeUsdt +
      fundingPlan.reserveBudgetUsdt >
      fundingPlan.spendableUsdt
  ) {
    return null;
  }

  const reserveLevels = config.watchReserveLevels ?? 2;

  return {
    config,
    direction,
    entryLevel: signal.lvl ?? 0,
    feeRate,
    fundingPlan,
    leverage,
    markPrice: mark.price,
    // Orders are sized by the fee-adjusted notional, not the margin budget.
    preferredQuantity: fundingPlan.availableNotionalUsdt / mark.price,
    signal,
    watch: {
      enabled: config.enableWatchLogic !== false,
      maxNextLevels: config.watchMaxNextAveragingLevels ?? reserveLevels,
      pctAlloc: config.watchReservePctAlloc ?? 2,
      reserveLevels,
    },
  };
}

/**
 * Builds the open-position record from an executed fill. Margin, fees, and the
 * reserve watch state are derived from the actual filled price and quantity —
 * identical math for simulated and exchange fills.
 */
function applyFill(
  context: RuntimeContext,
  decision: RuntimeEntryDecision,
  plan: EntryPlan,
  fill: EntryFill,
): Position | null {
  if (
    !Number.isFinite(fill.price) ||
    fill.price <= 0 ||
    !Number.isFinite(fill.quantity) ||
    fill.quantity <= 0
  ) {
    return null;
  }

  const notionalUsdt = fill.price * fill.quantity;
  const feeUsdt = notionalUsdt * plan.feeRate;
  const marginUsdt =
    plan.config.tradingMode === TradingMode.SPOT
      ? notionalUsdt
      : notionalUsdt / plan.leverage;
  const averaging = plan.watch.enabled
    ? reserve.state.build({
        direction: plan.direction,
        baseMarginUsdt: marginUsdt,
        entryLevel: plan.entryLevel,
        reserveLevels: plan.watch.reserveLevels,
        maxNextLevels: plan.watch.maxNextLevels,
        pctAlloc: plan.watch.pctAlloc,
      })
    : createEmptyAveragingState(plan.entryLevel, marginUsdt);

  const position: Position = {
    account: decision.accountSlug,
    symbol: decision.symbol.toUpperCase(),
    executionMode: fill.executionMode,
    tradingMode: plan.config.tradingMode,
    direction: plan.direction,
    opened: {
      t: fill.t,
      vPoint: { id: plan.signal.id, lvl: plan.entryLevel },
      reason: "COMMON",
      source: context.state.config.runtime.entrySignalBypass
        ? "BYPASS"
        : undefined,
      message: fill.message ?? decision.message,
      price: fill.price,
    },
    exposure: {
      averageEntryPrice: fill.price,
      quantity: fill.quantity,
      notionalUsdt,
      marginUsdt,
      leverage: plan.leverage,
    },
    fees: {
      entryUsdt: feeUsdt,
      estimatedExitUsdt: notionalUsdt * plan.feeRate,
    },
    strategy: {
      entry: {
        engine: plan.config.decisionEngineVersion,
        feature: normalizeEntryFeature(plan.signal.feature),
        label: plan.signal.descisionLabel,
      },
      averaging,
    },
    pnl: {
      currentValueUsdt: marginUsdt,
      history: [{ t: fill.t, pct: 0 }],
      markPrice: fill.price,
      maxDownPct: 0,
      maxDownUsdt: 0,
      maxUpPct: 0,
      maxUpUsdt: 0,
      netPct: 0,
      netUsdt: 0,
    },
  };

  if (context.state.mode === "backtest") {
    systemLog.info(
      `ENTRY ${position.symbol} ${position.direction} ` +
        `${format.timeForLog(position.opened.t)} | ` +
        `margin $${position.exposure.marginUsdt.toFixed(2)} | ` +
        `${position.opened.vPoint.id}`,
    );
  }

  return position;
}

/** Executes a simulated entry fill and returns the new open position. */
function execute(
  context: RuntimeContext,
  decision: RuntimeEntryDecision,
): Position | null {
  const entryPlan = buildPlan(context, decision);
  if (!entryPlan) return null;

  return applyFill(context, decision, entryPlan, {
    executionMode: "sandbox",
    price: entryPlan.markPrice,
    quantity: entryPlan.preferredQuantity,
    t: context.state.currentTime,
  });
}

const entryAction = {
  applyFill,
  execute,
  funding: {
    calculate: calculateEntryFundingPlan,
    requestedMargin: resolveRequestedEntryMargin,
  },
  plan: buildPlan,
} as const;

export default entryAction;
