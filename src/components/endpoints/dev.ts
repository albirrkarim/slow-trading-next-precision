import { DEV_UI_API } from "./constants";

export const devEndpoints = {
  coinTags: `${DEV_UI_API}/coin-tags`,
  coins: `${DEV_UI_API}/coins`,
  dynamicTrade: {
    backtest: `${DEV_UI_API}/dynamic-trade`,
    leaderboards: `${DEV_UI_API}/dynamic-trade/leaderboards`,
  },
} as const;
