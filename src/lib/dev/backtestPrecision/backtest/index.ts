import { RuntimeEngine } from "@/lib/precision";
import type {
  RuntimeEngineAdapter,
  RuntimeEngineState,
} from "@/lib/precision/types";
import type { BacktestPrecisionParams } from "../api/precision-api-types";
import { buildKlinesMap, getDatasetKlines, getEarliestOpenTime } from "./data";
import { createInitialBalance } from "./utils";

export async function precisionBacktest(
  params: BacktestPrecisionParams,
): Promise<void> {
  // A. Prepare klines
  // BTEST:BACKTEST_DATASET
  const [klinesMap1m, klinesMap5m] = await Promise.all([
    buildKlinesMap(params, "1m"),
    buildKlinesMap(params, "5m"),
  ]);

  const maps = {
    "1m": klinesMap1m,
    "5m": klinesMap5m,
  };

  // B. Prepare state and adapter
  const state: RuntimeEngineState = {
    balance: createInitialBalance(params),
    config: params.config,
    currentTime: params.startTime ?? getEarliestOpenTime(klinesMap1m),
    mode: "backtest",
    openPositions: [],
  };

  const adapter: RuntimeEngineAdapter = {
    market: {
      getKlines: (props) => getDatasetKlines(props, maps),
    },
    exchange: {},
    onStrategy: () => true,
    onAction: () => true,
    onNotif: () => true,
  };

  const engine = new RuntimeEngine(state, adapter);
}
