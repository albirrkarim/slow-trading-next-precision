import {
  getCurrentExchangeAccountSlug,
} from "@/lib/exchange/account-context";
import {
  TradingMode,
  UnifiedOrderSide,
  UnifiedOrderType,
  type IExchange,
  type UnifiedOrderParams,
  type UnifiedOrderResponse,
} from "@/lib/exchange";
import type { UnifiedFuturesPositionMode } from "@/lib/exchange/types";
import type {
  RuntimeAveragingDecision,
  RuntimeContext,
  RuntimeEntryDecision,
  RuntimeExitDecision,
} from "@/lib/precision/types";
import { systemLog } from "@/lib/system/logging";
import tradingAveraging, {
  type AveragingExecutionResult,
} from "@/lib/system/trading/averaging";
import entryAction, {
  type EntryExecutionResult,
} from "@/lib/system/trading/entry-action";
import tradingExit from "@/lib/system/trading/exit";
import type { Position } from "@/lib/system/trading";

/** Wait before re-reading the last order when a fill reports no executed qty. */
const EXECUTED_QTY_RETRY_DELAY_MS = 2_000;

/** Maps the runtime trading mode to the exchange enum. */
function toExchangeTradingMode(tradingMode?: string): TradingMode {
  return tradingMode === "futures" ? TradingMode.FUTURES : TradingMode.SPOT;
}

/** Maps the configured order style to the exchange enum. */
function toExchangeOrderType(orderType?: string): UnifiedOrderType {
  return orderType === "maker"
    ? UnifiedOrderType.LIMIT
    : UnifiedOrderType.MARKET;
}

/** Normalizes a base symbol to its USDT trading pair. */
function toTradingSymbol(symbol: string): string {
  return symbol.includes("_") ? symbol : `${symbol}_USDT`;
}

function toEffectiveConfig(context: RuntimeContext, accountSlug: string) {
  return {
    ...context.state.config.management,
    ...context.helper.getAccountConfig(accountSlug),
  };
}

/** Resolves the account-level futures position mode configured for a slug. */
function accountFuturesPositionMode(
  context: RuntimeContext,
  accountSlug: string,
): UnifiedFuturesPositionMode | undefined {
  return context.state.config.accounts.find(
    (account) => account.slug === accountSlug,
  )?.futuresPositionMode;
}

/**
 * BOTH:HEDGE_POSITION_SIDE — resolves the explicit exchange leg side for a
 * direction when the account runs hedge mode. Pair strategies require it:
 * LONG orders send `positionSide: "long"`, SHORT orders `"short"`, so an
 * account holds both directions on one symbol simultaneously. Undefined in
 * one-way mode — the legacy net-position behavior is untouched.
 */
function hedgePositionSide(
  futuresPositionMode: UnifiedFuturesPositionMode | undefined,
  direction: Position["direction"],
): "long" | "short" | undefined {
  if (futuresPositionMode !== "HEDGE") return undefined;
  return direction === "LONG" ? "long" : "short";
}

/**
 * Resolves the order-side fields shared by every full close: SELL closes
 * a LONG and BUY closes a SHORT. BOTH:HEDGE_CLOSE_POSITION_SIDE — hedge-
 * mode closes send the leg's `positionSide` instead of reduceOnly: the
 * exchange selects the leg to unwind from the side marker, and Binance
 * rejects reduceOnly under hedge mode. One-way futures closes carry
 * `reduceOnly` (PROD:CONFIRM_FUTURES_EXIT_ON_EXCHANGE).
 */
function closeOrderSide(
  futuresPositionMode: UnifiedFuturesPositionMode | undefined,
  position: Position,
  tradingMode: TradingMode,
): {
  positionSide: "long" | "short" | undefined;
  reduceOnly: true | undefined;
  side: UnifiedOrderSide;
} {
  const hedgeSide = hedgePositionSide(futuresPositionMode, position.direction);
  return {
    positionSide: hedgeSide,
    reduceOnly:
      tradingMode === TradingMode.FUTURES && hedgeSide === undefined
        ? true
        : undefined,
    side:
      position.direction === "LONG"
        ? UnifiedOrderSide.SELL
        : UnifiedOrderSide.BUY,
  };
}

/**
 * Resolves the actually executed price and quantity. When the order response
 * carries no executed quantity, the last-order lookup retries once after the
 * exchange settles, then falls back to the requested quantity.
 */
async function resolveExecutedFill(params: {
  exchange: IExchange;
  order: UnifiedOrderResponse;
  price: number;
  quantity: number;
  symbol: string;
}): Promise<{ price: number; quantity: number }> {
  const executedPrice = params.order.executedPrice || params.price;
  let executedQty = params.order.executedQty || 0;

  if (!executedQty) {
    try {
      await new Promise((resolve) =>
        setTimeout(resolve, EXECUTED_QTY_RETRY_DELAY_MS),
      );
      const lastOrder = await params.exchange.getLastOrder(params.symbol);
      if (lastOrder && lastOrder.orderId === params.order.orderId) {
        executedQty = lastOrder.executedQty || 0;
      }
    } catch (error) {
      systemLog.warn("[Execution] Failed to fetch executedQty update", error);
    }
  }

  if (!executedQty) {
    executedQty = params.quantity;
  }

  return { price: executedPrice, quantity: executedQty };
}

/**
 * Places a live entry order from the shared plan, then records the fill.
 * A plan refused by an entry gate returns the reason without throwing —
 * it is a skip, not an execution failure. Only exchange-side problems
 * (leverage setup, order placement, fill resolution) throw.
 */
async function entry(params: {
  context: RuntimeContext;
  decision: RuntimeEntryDecision;
  exchange: IExchange;
}): Promise<EntryExecutionResult> {
  const { context, decision, exchange } = params;
  const attempt = entryAction.planAttempt(context, decision);
  if (!attempt.plan) {
    return {
      blockReason:
        attempt.blockReason ?? "entry execution produced no position",
      position: null,
    };
  }
  const plan = attempt.plan;

  const tradingSymbol = toTradingSymbol(decision.symbol);
  const tradingMode = toExchangeTradingMode(plan.config.tradingMode);

  // PROD:FUTURES_ENTRY_ACCOUNT_SETUP
  if (tradingMode === TradingMode.FUTURES) {
    let leverageSet: boolean;
    try {
      leverageSet = await exchange.setLeverage(
        tradingSymbol,
        plan.leverage,
      );
    } catch (error) {
      throw new Error(
        `Failed to configure futures leverage for ${tradingSymbol} at ` +
          `${plan.leverage}x (account ${getCurrentExchangeAccountSlug()}): ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!leverageSet) {
      throw new Error(
        `Failed to configure futures leverage and isolated margin for ` +
          `${tradingSymbol} at ${plan.leverage}x ` +
          `(account ${getCurrentExchangeAccountSlug()})`,
      );
    }
  }

  const quantity = await exchange.adjustQuantity(
    plan.preferredQuantity,
    tradingSymbol,
  );
  if (quantity === 0) {
    return {
      blockReason:
        `Exchange adjusted ${tradingSymbol} entry quantity to 0 from ` +
        `${plan.preferredQuantity}; entry skipped.`,
      position: null,
    };
  }

  const orderParams: UnifiedOrderParams = {
    tradeType: "ENTRY",
    symbol: tradingSymbol,
    side:
      decision.direction === "LONG"
        ? UnifiedOrderSide.BUY
        : UnifiedOrderSide.SELL,
    type: toExchangeOrderType(plan.config.orderType),
    quantity,
    price: plan.markPrice,
    tradingMode,
    // Hedge-mode entries carry the leg side explicitly; Binance rejects a
    // pair leg without it.
    positionSide: hedgePositionSide(
      accountFuturesPositionMode(context, decision.accountSlug),
      decision.direction,
    ),
  };
  systemLog.log("[Execution] ENTRY Params:", orderParams);
  const order = await exchange.createOrder(orderParams);
  systemLog.log("[Execution] ENTRY Result:", JSON.stringify(order));

  const fill = await resolveExecutedFill({
    exchange,
    order,
    price: plan.markPrice,
    quantity,
    symbol: tradingSymbol,
  });

  return {
    position: await entryAction.applyFill(context, decision, plan, {
      executionMode: "live",
      price: fill.price,
      quantity: fill.quantity,
      t: context.state.currentTime,
    }),
  };
}

/** Places a live averaging order from the shared plan, then records the fill. */
async function averaging(params: {
  context: RuntimeContext;
  decision: RuntimeAveragingDecision;
  exchange: IExchange;
}): Promise<AveragingExecutionResult> {
  const { context, decision, exchange } = params;
  const attempt = tradingAveraging.planAttempt(context, decision);
  if (!attempt.plan) {
    return { blockReason: attempt.blockReason, position: null };
  }
  const plan = attempt.plan;

  const tradingSymbol = toTradingSymbol(decision.symbol);
  const tradingMode = toExchangeTradingMode(plan.config.tradingMode);
  const quantity = await exchange.adjustQuantity(
    plan.preferredQuantity,
    tradingSymbol,
  );
  if (quantity === 0) {
    return {
      blockReason:
        `Exchange adjusted ${tradingSymbol} averaging quantity to 0 ` +
        `from ${plan.preferredQuantity}; step skipped.`,
      position: null,
    };
  }

  const orderParams: UnifiedOrderParams = {
    tradeType: "ENTRY",
    symbol: tradingSymbol,
    side:
      plan.position.direction === "LONG"
        ? UnifiedOrderSide.BUY
        : UnifiedOrderSide.SELL,
    type: toExchangeOrderType(plan.config.orderType),
    quantity,
    price: plan.markPrice,
    tradingMode,
    // Averaging adds to the same hedge leg — explicit positionSide keeps it
    // on the opening side.
    positionSide: hedgePositionSide(
      accountFuturesPositionMode(context, plan.position.account),
      plan.position.direction,
    ),
  };
  systemLog.log("[Execution] AVERAGING Params:", orderParams);
  const order = await exchange.createOrder(orderParams);
  systemLog.log("[Execution] AVERAGING Result:", JSON.stringify(order));

  const fill = await resolveExecutedFill({
    exchange,
    order,
    price: plan.markPrice,
    quantity,
    symbol: tradingSymbol,
  });

  return {
    position: await tradingAveraging.applyFill(plan, {
      price: fill.price,
      quantity: fill.quantity,
      t: context.state.currentTime,
    }),
  };
}

/**
 * Places the live exit order for the full position quantity and confirms the
 * exchange position is flat for futures before accepting the close.
 */
async function exit(params: {
  context: RuntimeContext;
  decision: RuntimeExitDecision;
  exchange: IExchange;
}): Promise<Position | null> {
  const { context, decision, exchange } = params;
  const position = decision.position;
  const tradingSymbol = toTradingSymbol(decision.symbol);
  const tradingMode = toExchangeTradingMode(position.tradingMode);
  const config = toEffectiveConfig(context, decision.accountSlug);
  const mark = context.state.markPriceMap[decision.symbol.toUpperCase()];

  const closeSide = closeOrderSide(
    accountFuturesPositionMode(context, position.account),
    position,
    tradingMode,
  );
  const orderParams: UnifiedOrderParams = {
    tradeType: "EXIT",
    symbol: tradingSymbol,
    side: closeSide.side,
    type: toExchangeOrderType(config.orderType),
    quantity: position.exposure.quantity,
    price: mark?.price,
    tradingMode,
    positionSide: closeSide.positionSide,
    reduceOnly: closeSide.reduceOnly,
  };
  systemLog.debug("[Execution] EXIT Params:", orderParams);
  const order = await exchange.createOrder(orderParams);
  systemLog.debug("[Execution] EXIT Result:", JSON.stringify(order));

  if (tradingMode === TradingMode.FUTURES) {
    const confirmation = await exchange.ensureClosed({
      direction: position.direction,
      symbol: tradingSymbol,
      positionSide: closeSide.positionSide,
    });
    if (!confirmation.closed) {
      throw new Error(
        `Exchange still reports ${confirmation.remainingAmount} ` +
          `${tradingSymbol} after exit confirmation`,
      );
    }
  }

  return tradingExit.execute(context, decision);
}

/**
 * Compensating close for a filled pair leg whose sibling leg failed —
 * called by `adapter.onPairAction` rollback before the engine commits
 * anything. Places a market close on the leg's hedge side (no reduceOnly —
 * Binance rejects it under hedge mode) and confirms the exchange leg is
 * flat so a failed pair never leaves an unpaired live position.
 */
async function closeLeg(params: {
  context: RuntimeContext;
  position: Position;
  exchange: IExchange;
  reason: string;
}): Promise<void> {
  const { context, position, exchange, reason } = params;
  const tradingSymbol = toTradingSymbol(position.symbol);
  const tradingMode = toExchangeTradingMode(position.tradingMode);
  const closeSide = closeOrderSide(
    accountFuturesPositionMode(context, position.account),
    position,
    tradingMode,
  );

  systemLog.warn(
    `[Execution] PAIR ROLLBACK ${position.symbol} ${position.direction} ` +
      `(account ${position.account}): ${reason}`,
  );
  const order = await exchange.createOrder({
    tradeType: "EXIT",
    symbol: tradingSymbol,
    side: closeSide.side,
    type: UnifiedOrderType.MARKET,
    quantity: position.exposure.quantity,
    tradingMode,
    positionSide: closeSide.positionSide,
    reduceOnly: closeSide.reduceOnly,
  });
  systemLog.log("[Execution] PAIR ROLLBACK Result:", JSON.stringify(order));

  if (tradingMode === TradingMode.FUTURES) {
    const confirmation = await exchange.ensureClosed({
      direction: position.direction,
      symbol: tradingSymbol,
      positionSide: closeSide.positionSide,
    });
    if (!confirmation.closed) {
      throw new Error(
        `Pair rollback left ${confirmation.remainingAmount} ` +
          `${tradingSymbol} open for ${position.account} — manual ` +
          `intervention required (reason: ${reason})`,
      );
    }
  }
}

const execution = {
  averaging,
  closeLeg,
  entry,
  exit,
} as const;

export default execution;
export { execution };
