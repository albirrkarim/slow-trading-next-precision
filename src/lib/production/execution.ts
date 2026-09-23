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
import type {
  RuntimeAveragingDecision,
  RuntimeContext,
  RuntimeEntryDecision,
  RuntimeExitDecision,
} from "@/lib/precision/types";
import { systemLog } from "@/lib/system/logging";
import tradingAveraging from "@/lib/system/trading/averaging";
import entryAction from "@/lib/system/trading/entry-action";
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

/** Places a live entry order from the shared plan, then records the fill. */
async function entry(params: {
  context: RuntimeContext;
  decision: RuntimeEntryDecision;
  exchange: IExchange;
}): Promise<Position | null> {
  const { context, decision, exchange } = params;
  const plan = entryAction.plan(context, decision);
  if (!plan) return null;

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
  if (quantity === 0) return null;

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

  return entryAction.applyFill(context, decision, plan, {
    executionMode: "live",
    price: fill.price,
    quantity: fill.quantity,
    t: context.state.currentTime,
  });
}

/** Places a live averaging order from the shared plan, then records the fill. */
async function averaging(params: {
  context: RuntimeContext;
  decision: RuntimeAveragingDecision;
  exchange: IExchange;
}): Promise<Position | null> {
  const { context, decision, exchange } = params;
  const plan = tradingAveraging.plan(context, decision);
  if (!plan) return null;

  const tradingSymbol = toTradingSymbol(decision.symbol);
  const tradingMode = toExchangeTradingMode(plan.config.tradingMode);
  const quantity = await exchange.adjustQuantity(
    plan.preferredQuantity,
    tradingSymbol,
  );
  if (quantity === 0) return null;

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

  return tradingAveraging.applyFill(plan, {
    price: fill.price,
    quantity: fill.quantity,
    t: context.state.currentTime,
  });
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

  const orderParams: UnifiedOrderParams = {
    tradeType: "EXIT",
    symbol: tradingSymbol,
    side:
      position.direction === "LONG"
        ? UnifiedOrderSide.SELL
        : UnifiedOrderSide.BUY,
    type: toExchangeOrderType(config.orderType),
    quantity: position.exposure.quantity,
    price: mark?.price,
    tradingMode,
    // PROD:CONFIRM_FUTURES_EXIT_ON_EXCHANGE
    reduceOnly: tradingMode === TradingMode.FUTURES,
  };
  systemLog.debug("[Execution] EXIT Params:", orderParams);
  const order = await exchange.createOrder(orderParams);
  systemLog.debug("[Execution] EXIT Result:", JSON.stringify(order));

  if (tradingMode === TradingMode.FUTURES) {
    const confirmation = await exchange.ensureClosed({
      direction: position.direction,
      symbol: tradingSymbol,
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

const execution = {
  averaging,
  entry,
  exit,
} as const;

export default execution;
export { execution };
