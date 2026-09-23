import { DEV_UI_API } from "./constants";

export const devEndpoints = {
  backtestPrecision: {
    backtest: `${DEV_UI_API}/backtest-precision`,
  },
  precisionChecker: `${DEV_UI_API}/precision-checker`,
} as const;
