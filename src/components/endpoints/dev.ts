import { DEV_API } from "./constants";

export const devEndpoints = {
  backtestPrecision: `${DEV_API}/backtest-precision`,
  backtestPrecisionDetail: `${DEV_API}/backtest-precision/detail`,
  backtestPrecisionLeaderboardProfiles: `${DEV_API}/backtest-precision/leaderboard-profiles`,
  backtestPrecisionLeaderboards: `${DEV_API}/backtest-precision/leaderboards`,
  featureGateDatasetRows: `${DEV_API}/feature-gate/dataset-rows`,
  featureGateDatasets: `${DEV_API}/feature-gate/datasets`,
  featureGateEvaluate: `${DEV_API}/feature-gate/evaluate`,
  featureGateList: `${DEV_API}/feature-gate/list`,
  precisionChecker: `${DEV_API}/precision-checker`,
} as const;
