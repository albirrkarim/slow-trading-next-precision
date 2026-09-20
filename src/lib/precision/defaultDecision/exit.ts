import type {
  DynamicTradeConfig,
  PredictionEngineMemory,
} from "@/lib/dynamic";
import type { Kline } from "@/lib/exchange/platform/tokocrypto";
import trading from "@/lib/trading";
import type { Position, TradingModelMemory } from "@/lib/trading/models";

import type { RuntimeContext, RuntimeExitDecision } from "../types";

/** Creates the current synthetic candle consumed by the production exit model. */
function createCurrentKline(context: RuntimeContext, symbol: string): Kline {
  const markPrice = context.state.markPriceMap[symbol];
  if (!markPrice) {
    throw new Error(`Runtime mark price not found for ${symbol}.`);
  }

  const price = String(markPrice.price);
  return [
    context.state.currentTime,
    price,
    price,
    price,
    price,
    "0",
    context.state.currentTime,
    "0",
    0,
    "0",
    "0",
    "",
    new Date(context.state.currentTime).toISOString(),
  ];
}

/** Evaluates the production exit model against cloned runtime state. */
async function find(
  context: RuntimeContext,
  position: Position,
): Promise<RuntimeExitDecision | null> {
  const symbol = position.symbol.toUpperCase();
  const accountConfig = context.helper.getAccountConfig(position.account);
  const config: DynamicTradeConfig = {
    ...context.state.config.management,
    ...accountConfig,
  };
  const clonedPosition = structuredClone(position);
  const volatilityPoints = structuredClone(
    context.state.vPointsMap[symbol] ?? [],
  );
  const memory: TradingModelMemory = {
    positions: [clonedPosition],
    positionsSell: [],
    volatility: {
      symbol,
      lastVolatility: volatilityPoints,
    } as PredictionEngineMemory,
  };
  const tradeDecision = await trading.decision.exit({
    bypass: false,
    config,
    current: createCurrentKline(context, symbol),
    exchangeType: context.state.config.management.exchangeType,
    memory,
    symbol,
    tradingMode: context.state.config.management.tradingMode,
  });
  if (tradeDecision.action !== "SELL") return null;

  return {
    accountSlug: position.account,
    message: tradeDecision.reason ?? tradeDecision.log ?? "Exit approved",
    position,
    symbol,
    tradeDecision,
    type: "exit",
  };
}

const exit = { find } as const;

export default exit;
