import { computeLeaderboardMetrics } from "./metrics";
import * as leaves from "./leaves";
import leaderboardProfiles from "./profiles";
import leaderboardsStore from "./store";

const backtestLeaderboards = {
  leaves,
  metrics: {
    compute: computeLeaderboardMetrics,
  },
  profiles: leaderboardProfiles,
  store: leaderboardsStore,
} as const;

export default backtestLeaderboards;
export type {
  BacktestLeaderboardEntry,
  BacktestLeaderboardMetrics,
  LeaderboardProfile,
  LeaderboardRange,
} from "./types";
