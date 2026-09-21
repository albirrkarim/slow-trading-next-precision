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

const BACKTEST_ENTRY_CUTOFF_MS = 4 * 24 * 60 * 60 * 1000;

interface PrecisionBacktestParams extends BacktestPrecisionParams {
  mode?: "backtest" | "precision-checker";
}

export async function precisionBacktest(
  params: PrecisionBacktestParams,
): Promise<BacktestPrecisionResult> {
  // Precision checker replays a recorded production window, so entries must
  // be allowed all the way to the end to match what production did.
  const isPrecisionChecker = params.mode === "precision-checker";
  const initialState = isPrecisionChecker ? params.initialState : undefined;
  if (isPrecisionChecker && !initialState) {
    throw new Error(
      "Precision checker replay requires a captured initial runtime state.",
    );
  }

  // A. Prepare klines
  // BTEST:BACKTEST_DATASET
  const dataset = await preparePrecisionDataset(
    isPrecisionChecker ? params : { ...params, initialState: undefined },
  );

  // B. Prepare state and adapter
  const { symbols } = dataset;
  const datasetStartTime = dataset.startTime;
  const endTime = dataset.endTime;
  const entryCutoffTime = isPrecisionChecker
    ? Number.POSITIVE_INFINITY
    : endTime - BACKTEST_ENTRY_CUTOFF_MS;

  // i think we make the backtest forward two month,
  // so we can make the initial vPointsMap first.
  const currentTime =
    initialState?.t ?? datasetStartTime + windowsMs["1m"] * 2;
  if (!isPrecisionChecker && currentTime >= endTime) {
    throw new Error(
      "Precision backtest requires more than two months of data for volatility warm-up.",
    );
  }

  const vPointsMap =
    initialState !== undefined
      ? structuredClone(initialState.vPointsMap)
      : await createInitialVPointsMap(
          symbols,
          dataset.getKlines,
          datasetStartTime,
          currentTime,
        );

  const state: RuntimeEngineState = {
    balance:
      initialState !== undefined
        ? structuredClone(initialState.balance)
        : createInitialBalance(params),
    config: params.config,
    currentTime,
    mode: "backtest",
    openPositions:
      initialState !== undefined
        ? structuredClone(initialState.openPositions)
        : [],
    markPriceMap: {},
    vPointsMap,
  };
  let clockTime = state.currentTime;
  const history: RuntimeEngineState["openPositions"] = [];
  const logProgress = createProgressLogger(
    clockTime,
    endTime,
    () => history.length,
  );
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
    onStrategy: async (decision, context) => {
      // BTEST:STOP_AUTO_ENTRY_BEFORE_END
      // Keep monitoring existing positions during the final four days, but do
      // not open new positions that cannot complete their lifecycle in-range.
      if (
        decision.type === "entry" &&
        context.state.currentTime >= entryCutoffTime
      ) {
        return false;
      }

      return true;
    },
    onAction: simulatedAction.execute,
    onExit: async (position) => {
      history.push(position);
    },
    onNotif: () => true,
  };

  const engine = new RuntimeEngine(state, adapter);
  await engine.start();

  return {
    exchangeType: params.config.management.exchangeType,
    vPointsMap,
    positions: [...history, ...state.openPositions],
  };
}
