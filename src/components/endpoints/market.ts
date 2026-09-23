import { MARKET_API } from "./constants";

export const marketEndpoints = {
  fundingRates: `${MARKET_API}/funding-rates`,
  initialize: `${MARKET_API}/initialize`,
  klines: `${MARKET_API}/klines`,
  volatility: `${MARKET_API}/volatility`,
} as const;
