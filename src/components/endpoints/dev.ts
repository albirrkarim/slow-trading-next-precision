import { DEV_API } from "./constants";

export const devEndpoints = {
  backtestPrecision: `${DEV_API}/backtest-precision`,
  backtestPrecisionDetail: `${DEV_API}/backtest-precision/detail`,
  backtestPrecisionLeaderboards: `${DEV_API}/backtest-precision/leaderboards`,
  precisionChecker: `${DEV_API}/precision-checker`,
} as const;
