import { RuntimeEngine } from "@/lib/precision";
import type {
  RuntimeEngineAdapter,
  RuntimeEngineState,
} from "@/lib/precision/types";
import type { BacktestPrecisionParams } from "../api/precision-api-types";
import {
  buildKlinesMap,
  getDatasetKlines,
  getEarliestOpenTime,
  getLatestCommonCloseTime,
} from "./data";
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
  const datasetEndTime = getLatestCommonCloseTime(klinesMap1m);
  const endTime = Math.min(params.endTime ?? datasetEndTime, datasetEndTime);
  let currentTime = state.currentTime;

  const adapter: RuntimeEngineAdapter = {
    clock: {
      advanceTo(time) {
        currentTime = Math.min(time, endTime);
      },
      finished() {
        return currentTime >= endTime;
      },
      now() {
        return currentTime;
      },
    },
    market: {
      getKlines: (props) => getDatasetKlines(props, maps),
    },
    exchange: {},
    onStrategy: () => true,
    onAction: () => true,
    onNotif: () => true,
  };

  const engine = new RuntimeEngine(state, adapter);
  await engine.start();
}
