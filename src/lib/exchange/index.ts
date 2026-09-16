import { OKXAdapter } from "./adapters/okx";
import { TokocryptoAdapter } from "./adapters/tokocrypto";
import { BinanceAdapter } from "./adapters/binance";
import { getDefaultExchange } from "./config";
import type { ExchangeType, IExchange, ExchangeConfig } from "./types";

// Cache for exchange instances (keyed by exchange type and trading mode)
const exchangeCache = new Map<string, IExchange>();

/**
 * Optional process-wide exchange factory override. Installed at a composition
 * boundary (for example the precision backtest driver) so every runtime
 * consumer receives a deterministic environment exchange.
 */
type ExchangeFactoryOverride = (
  exchangeType?: ExchangeType,
  config?: ExchangeConfig,
) => IExchange | undefined;

let exchangeFactoryOverride: ExchangeFactoryOverride | undefined;

/** Installs the process-wide exchange factory override. */
export function setExchangeFactoryOverride(
  override: ExchangeFactoryOverride | undefined,
): void {
  exchangeFactoryOverride = override;
}

/** Removes the installed exchange factory override. */
export function clearExchangeFactoryOverride(): void {
  exchangeFactoryOverride = undefined;
}

/**
 * Generate cache key for exchange instance
 */
function getCacheKey(exchangeType: ExchangeType, tradingMode?: string): string {
  return tradingMode ? `${exchangeType}:${tradingMode}` : exchangeType;
}

/**
 * Get an exchange instance
 * @param exchangeType - Optional exchange type, uses default if not provided
 * @param config - Optional exchange configuration (e.g., default trading mode)
 * @returns Exchange adapter instance
 */
export function getExchange(
  exchangeType?: ExchangeType,
  config?: ExchangeConfig,
): IExchange {
  const type = exchangeType || getDefaultExchange();

  if (exchangeFactoryOverride) {
    const override = exchangeFactoryOverride(type, config);
    if (override) {
      return override;
    }
  }

  const cacheKey = getCacheKey(type, config?.defaultTradingMode);

  // Return cached instance if available
  if (exchangeCache.has(cacheKey)) {
    return exchangeCache.get(cacheKey)!;
  }

  // Create new instance
  let exchange: IExchange;
  switch (type) {
    case "okx":
      exchange = new OKXAdapter(config);
      break;
    case "tokocrypto":
      exchange = new TokocryptoAdapter();
      break;
    case "binance":
      exchange = new BinanceAdapter(config);
      break;
    default:
      throw new Error(`Unsupported exchange type: ${type}`);
  }

  // Cache the instance
  // exchangeCache.set(cacheKey, exchange);
  return exchange;
}

// Re-export types and interfaces
export type {
  ExchangeType,
  IExchange,
  UnifiedBalance,
  UnifiedGetKlinesParams,
  UnifiedOrderParams,
  UnifiedOrderResponse,
  UnifiedPosition,
  UnifiedFundingRate,
  FeeCalculator,
  ExchangeConfig,
  ExchangeEnsureClosedParams,
  ExchangeEnsureClosedResult,
  IntervalKlines,
  UnifiedWithdrawAssetParams,
  UnifiedWithdrawAssetResponse,
} from "./types";

// Re-export enums as values (not types)
export { UnifiedOrderSide, UnifiedOrderType, TradingMode } from "./types";

// Re-export config functions
export {
  getDefaultExchange,
  setDefaultExchange,
  resetDefaultExchange,
} from "./config";

// Re-export adapters for advanced use cases
export { OKXAdapter } from "./adapters/okx";
export { TokocryptoAdapter } from "./adapters/tokocrypto";
export { BinanceAdapter } from "./adapters/binance";
