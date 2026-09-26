import { RuntimeEngine } from "@/lib/precision";
import type {
  RuntimeEngineAdapter,
  RuntimeEngineState,
} from "@/lib/precision/types";
import type { VolatilityPoint } from "@/lib/system/types";
import vpoints from "@/lib/system/utils/vpoints";
import { getFeeCalculator } from "@/lib/exchange/fees";
import tradingAveraging from "@/lib/system/trading/averaging";
import runtimeDailyPnlLimit from "@/lib/system/trading/daily-pnl-limit";
import entryAction from "@/lib/system/trading/entry-action";
import tradingExit from "@/lib/system/trading/exit";
import type { BacktestPrecisionParams } from "../api/precision-api-types";
import { preparePrecisionDataset } from "./data";
import {
  createInitialBalance,
  createInitialVPointsMap,
  createProgressLogger,
  snapshotAccountBalances,
} from "./utils";
import type { BacktestPrecisionResult } from "./backtest-precision-types";

const BACKTEST_ENTRY_CUTOFF_MS = 4 * 24 * 60 * 60 * 1000;
const VPOINT_WARMUP_MS = 2 * 30 * 24 * 60 * 60_000;

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
  if (
    isPrecisionChecker &&
    (!Number.isFinite(params.startTime) || !Number.isFinite(params.endTime))
  ) {
    throw new Error(
      "Precision checker replay requires finite startTime and endTime.",
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
  const currentTime = isPrecisionChecker
    ? (params.startTime as number)
    : datasetStartTime + VPOINT_WARMUP_MS;
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
  // The engine trims state.vPointsMap to the same recent window production
  // uses; the full map returned to callers is rebuilt from this untouched
  // seed plus every point reported through `onNewVPoint`.
  const initialVPointsMap = structuredClone(vPointsMap);
  const detectedVPoints: Record<string, VolatilityPoint[]> = {};

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
    strategy: structuredClone(initialState?.strategy),
  };
  let clockTime = state.currentTime;
  const history: RuntimeEngineState["openPositions"] = [];
  const balanceSnapshots: BacktestPrecisionResult["balanceSnapshots"] = {};
  const captureBalance = () => {
    const snapshots = snapshotAccountBalances(
      state.balance,
      state.currentTime,
    );
    for (const [slug, snapshot] of Object.entries(snapshots)) {
      const list = (balanceSnapshots[slug] ??= []);
      const last = list[list.length - 1];
      if (last && last.t === snapshot.t) {
        list[list.length - 1] = snapshot;
      } else {
        list.push(snapshot);
      }
    }
  };
  captureBalance();
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
    exchange: {
      getFeeRate({ side, type }) {
        return (
          getFeeCalculator(params.config.management.exchangeType)
            .getTotalFeePercent({ currency: "USDT", side, type }) / 100
        );
      },
      getRoundTripFeeRate({ type }) {
        return (
          getFeeCalculator(params.config.management.exchangeType)
            .getBothSideFeePercent({ currency: "USDT", type }) / 100
        );
      },
    },
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

      // BOTH:AUTO_ENTRY_DAILY_PNL_LIMIT_USDT — mirrors the production
      // isActionAllowed veto: automatic entries pause once the current UTC
      // day's closed net PnL reaches the configured stop. `history` holds
      // this run's closed positions, matching production's persisted daily
      // history read. Manual forced entries are exempt, same as production.
      if (decision.type === "entry" && !decision.manual) {
        const evaluation = runtimeDailyPnlLimit.guard.evaluate({
          currentTimeMs: context.state.currentTime,
          positions: history,
          thresholdUsdt:
            context.state.config.runtime.autoEntryDailyPnlLimitUSDT,
        });
        if (evaluation.reached) return false;
      }

      return true;
    },
    onAction: async (decision, context) => {
      const executed =
        decision.type === "entry"
          ? await entryAction.execute(context, decision)
          : decision.type === "averaging"
            ? await tradingAveraging.execute(context, decision)
            : decision.type === "exit"
              ? await tradingExit.execute(context, decision)
              : null;
      captureBalance();
      return executed;
    },
    onExit: async (position) => {
      history.push(position);
    },
    onNewVPoint: async (symbol, newVPoint) => {
      (detectedVPoints[symbol] ??= []).push(newVPoint);
    },
    onNotif: () => true,
  };

  const engine = new RuntimeEngine(state, adapter);
  await engine.start();
  captureBalance();

  const resultVPointsMap = Object.fromEntries(
    [
      ...new Set([
        ...Object.keys(initialVPointsMap),
        ...Object.keys(detectedVPoints),
      ]),
    ].map((symbol) => [
      symbol,
      vpoints.mergeById(
        initialVPointsMap[symbol] ?? [],
        detectedVPoints[symbol] ?? [],
      ),
    ]),
  );

  return {
    exchangeType: params.config.management.exchangeType,
    vPointsMap: resultVPointsMap,
    positions: [...history, ...state.openPositions],
    balanceSnapshots,
  };
}
