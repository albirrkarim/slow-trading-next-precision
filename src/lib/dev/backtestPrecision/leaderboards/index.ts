import { computeLeaderboardMetrics } from "./metrics";
import leaderboardsStore from "./store";

const backtestLeaderboards = {
  metrics: {
    compute: computeLeaderboardMetrics,
  },
  store: leaderboardsStore,
} as const;

export default backtestLeaderboards;
export type {
  BacktestLeaderboardEntry,
  BacktestLeaderboardMetrics,
  LeaderboardRange,
} from "./types";
