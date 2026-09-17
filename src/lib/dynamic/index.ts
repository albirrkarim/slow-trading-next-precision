import {
  DEFAULT_DYNAMIC_TRADE_CONFIG_PRODUCTION,
  DEFAULT_DYNAMIC_TRADING_MEMORY,
} from "./constants";
import { countGrowthOvertime } from "./utils/assets";
import {
  buildMonthToSeasonMap,
  findSeasonIndexForMonth,
  monthFromMs,
  validateSeasonalConfig,
} from "./utils/config";

export type * from "./type-backtest.d";
export type * from "./type-dynamic.d";

export * from "./client";
export * from "./constants";

export * from "./utils/assets";
export * from "./utils/config";
export * from "./utils/data";
export * from "./utils/nn/data/features/data";
export * from "./utils/volatility";
export * from "./utils/volatility/engine";
export * from "./utils/volatility/memory_design";
export { dynamic };

/**
 * Grouped dynamic/backtest API for callers that need related dynamic trading
 * helpers without importing many standalone functions.
 */
const dynamic = {
  defaults: {
    tradeConfigProduction: DEFAULT_DYNAMIC_TRADE_CONFIG_PRODUCTION,
    tradingMemory: DEFAULT_DYNAMIC_TRADING_MEMORY,
  },
  balance: {
    countGrowthOvertime,
  },
  config: {
    buildMonthToSeasonMap,
    findSeasonIndexForMonth,
    monthFromMs,
    validateSeasonalConfig,
  },
} as const;

export default dynamic;
