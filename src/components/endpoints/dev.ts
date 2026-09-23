import { DEV_API } from "./constants";

export const devEndpoints = {
  backtestPrecision: `${DEV_API}/backtest-precision`,
  precisionChecker: `${DEV_API}/precision-checker`,
} as const;
