import { RuntimeEngine } from "@/lib/precision";
import type {
  RuntimeEngineAdapter,
  RuntimeEngineState,
} from "@/lib/precision/types";
import type { BacktestPrecisionParams } from "../api/precision-api-types";
import { preparePrecisionDataset } from "./data";
import {
  createInitialBalance,
  createInitialVPointsMap,
  createProgressLogger,
} from "./utils";
import { windowsMs } from "@/lib/dynamic/constants-time";
import simulatedAction from "@/lib/precision/action/simulated";
import type { BacktestPrecisionResult } from "./backtest-precision-types";

export async function precisionBacktest(
  params: BacktestPrecisionParams,
): Promise<BacktestPrecisionResult> {
  // A. Prepare klines
  // BTEST:BACKTEST_DATASET
  const dataset = await preparePrecisionDataset(params);

  // B. Prepare state and adapter
  const { symbols } = dataset;
  const datasetStartTime = dataset.startTime;
  const endTime = dataset.endTime;

  // i think we make the backtest forward two month,
  // so we can make the initial vPointsMap first.
  const currentTime = datasetStartTime + windowsMs["1m"] * 2;
  if (currentTime >= endTime) {
    throw new Error(
      "Precision backtest requires more than two months of data for volatility warm-up.",
    );
  }
  const vPointsMap = await createInitialVPointsMap(
    symbols,
    dataset.getKlines,
    datasetStartTime,
    currentTime,
  );

  const state: RuntimeEngineState = {
    balance: createInitialBalance(params),
    config: params.config,
    currentTime,
    mode: "backtest",
    openPositions: [],
    markPriceMap: {},
    vPointsMap,
  };
  let clockTime = state.currentTime;
  const history: RuntimeEngineState["openPositions"] = [];
  const logProgress = createProgressLogger(clockTime, endTime);
  logProgress(clockTime);

  const adapter: RuntimeEngineAdapter = {
    clock: {
      advanceTo(time) {
        clockTime = Math.min(time, endTime);
        logProgress(clockTime);
      },
      finished() {
        return clockTime >= endTime;
      },
      now() {
        return clockTime;
      },
    },
    market: {
      getKlines: dataset.getKlines,
    },
    exchange: {},
    onStrategy: async () => true,
    onAction: simulatedAction.execute,
    onExit: async (position) => {
      history.push(position);
    },
    onNotif: () => true,
  };

  const engine = new RuntimeEngine(state, adapter);
  await engine.start();

  return {
    vPointsMap,
    positions: [...history, ...state.openPositions],
  };
}
