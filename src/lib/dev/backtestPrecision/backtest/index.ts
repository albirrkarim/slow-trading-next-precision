import features from "@/lib/features";
import { RuntimeEngine } from "@/lib/precision";
import type {
  RuntimeEngineAdapter,
  RuntimeEngineState,
} from "@/lib/precision/types";
import type { VolatilityPoint } from "@/lib/system/types";
import vpoints from "@/lib/system/utils/vpoints";
import { getFeeCalculator } from "@/lib/exchange/fees";
import tradingAveraging from "@/lib/system/trading/averaging";
import entryAction from "@/lib/system/trading/entry-action";
import pairAction from "@/lib/system/trading/pair-action";
import tradingExit from "@/lib/system/trading/exit";
import blackSwan from "@/lib/system/trading/black-swan";
import strategies from "@/lib/strategies";
import type { BacktestPrecisionParams } from "../api/precision-api-types";
import backtestArtifacts from "./artifacts";
import backtestBlackSwan from "./black-swan";
import {
  VPOINT_WARMUP_MS,
  type BacktestArtifactTarget,
  type BacktestBlackSwanTimeline,
  type BacktestBlackSwanTransition,
  type BacktestChunkedResult,
  type BacktestFeatureRecord,
  type BacktestPrecisionResult,
} from "./backtest-precision-types";
import { preparePrecisionDataset } from "./data";
import backtestStats from "./stats";
import {
  createInitialBalance,
  createInitialVPointsMap,
  createProgressLogger,
  snapshotAccountBalances,
} from "./utils";

const BACKTEST_ENTRY_CUTOFF_MS = 4 * 24 * 60 * 60 * 1000;

interface PrecisionBacktestParams extends BacktestPrecisionParams {
  mode?: "backtest" | "precision-checker";
  /**
   * Set by the API layer (never read from the request body): streams result
   * artifacts to fixed-size part files so long runs retain only the current
   * chunk in memory instead of every closed position, vPoint, and snapshot.
   */
  artifacts?: BacktestArtifactTarget;
}

export function precisionBacktest(
  params: PrecisionBacktestParams & { artifacts: BacktestArtifactTarget },
): Promise<BacktestChunkedResult>;
export function precisionBacktest(
  params: PrecisionBacktestParams,
): Promise<BacktestPrecisionResult>;
export async function precisionBacktest(
  params: PrecisionBacktestParams,
): Promise<BacktestChunkedResult | BacktestPrecisionResult> {
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
          params.config.management,
        );
  const spool = params.artifacts
    ? backtestArtifacts.spool.create(
        params.artifacts.dir,
        params.artifacts.chunkSize,
      )
    : null;
  const stats = backtestStats.tracker.create();

  // The engine trims state.vPointsMap to the same recent window production
  // uses; the full map returned to callers is rebuilt from this untouched
  // seed plus every point reported through `onNewVPoint`. A chunked run
  // streams the seed to disk before the engine mutates the working map.
  if (spool) {
    for (const [symbol, points] of Object.entries(vPointsMap)) {
      for (const point of points) {
        await spool.pushVPoint(symbol, point);
        stats.onVPoint();
      }
    }
  }
  const initialVPointsMap: Record<string, VolatilityPoint[]> = spool
    ? {}
    : structuredClone(vPointsMap);
  const detectedVPoints: Record<string, VolatilityPoint[]> = {};
  const detectedFeatures: Record<string, BacktestFeatureRecord[]> = {};

  const state: RuntimeEngineState = {
    balance:
      initialState !== undefined
        ? structuredClone(initialState.balance)
        : createInitialBalance(params),
    // BTEST:STOP_AUTO_ENTRY_BEFORE_END — the shared env guard applies this
    // bound; precision-checker replays leave it unset so entries match what
    // production did to the end of the window.
    entryCutoffTime: isPrecisionChecker
      ? undefined
      : endTime - BACKTEST_ENTRY_CUTOFF_MS,
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
    blackSwanProtective: initialState?.blackSwanStatus
      ? blackSwan.state.isProtective(initialState.blackSwanStatus)
      : initialState?.blackSwanProtective,
    blackSwanStatus: isPrecisionChecker
      ? initialState?.blackSwanStatus === undefined
        ? undefined
        : structuredClone(initialState.blackSwanStatus)
      : undefined,
    dailyPnlDay: initialState?.dailyPnlDay,
    dailyPnlUsdt: initialState?.dailyPnlUsdt,
    // Replays hydrate the captured feature store so the first tick matches
    // what production saw; `features.update` recomputes it deterministically
    // on every feature-update pass afterwards.
    features:
      initialState?.features === undefined
        ? undefined
        : structuredClone(initialState.features),
  };
  let clockTime = state.currentTime;
  const history: RuntimeEngineState["openPositions"] = [];
  const balanceSnapshots: BacktestPrecisionResult["balanceSnapshots"] = {};
  const captureBalance = async () => {
    const snapshots = snapshotAccountBalances(
      state.balance,
      state.currentTime,
    );
    for (const [slug, snapshot] of Object.entries(snapshots)) {
      stats.onSnapshot(slug, snapshot);
      if (spool) {
        await spool.pushSnapshot(slug, snapshot);
        continue;
      }
      const list = (balanceSnapshots[slug] ??= []);
      const last = list[list.length - 1];
      if (last && last.t === snapshot.t) {
        list[list.length - 1] = snapshot;
      } else {
        list.push(snapshot);
      }
    }
  };
  await captureBalance();
  const logProgress = createProgressLogger(
    clockTime,
    endTime,
    () => stats.counts().closedPositions,
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
    onAction: async (decision, context) => {
      const executed =
        decision.type === "entry"
          ? (() => {
              const result = entryAction.executeWithReason(context, decision);
              if (!result.position && result.blockReason) {
                decision.blockReason = result.blockReason;
              }
              return result.position;
            })()
          : decision.type === "averaging"
            ? (() => {
                const result = tradingAveraging.executeWithReason(
                  context,
                  decision,
                );
                if (!result.position && result.blockReason) {
                  decision.blockReason = result.blockReason;
                }
                return result.position;
              })()
            : decision.type === "exit"
              ? await tradingExit.execute(context, decision)
              : null;
      await captureBalance();
      return executed;
    },
    // BTEST:PAIR_ENTRY_SIMULATED_ATOMIC — simulated legs never touch an
    // exchange, so a failed later leg discards the earlier uncommitted
    // fills; identical semantics to live's compensating-close rollback.
    onPairAction: async (decision, context) => {
      const filled = await pairAction.execute({
        context,
        decision,
        executeLeg: (leg, ctx) => {
          const result = entryAction.executeWithReason(ctx, leg);
          if (!result.position && result.blockReason) {
            leg.blockReason = result.blockReason;
          }
          return result.position;
        },
      });
      if (!filled) {
        decision.blockReason = decision.legs.find(
          (leg) => leg.blockReason,
        )?.blockReason;
      }
      await captureBalance();
      return filled;
    },
    onExit: async (position) => {
      stats.onExit(position);
      if (spool) {
        await spool.pushPosition(position);
        return;
      }
      history.push(position);
    },
    onNewVPoint: async (symbol, newVPoint) => {
      stats.onVPoint();
      if (spool) {
        await spool.pushVPoint(symbol, newVPoint);
        return;
      }
      (detectedVPoints[symbol] ??= []).push(newVPoint);
    },
    // BTEST:FEATURES_ARTIFACT — same shared compute as production, then the
    // changed coins append `{t, ...coinFeatures}` rows per symbol so the
    // dashboard can chart feature values over the run.
    onFeatureUpdate: async (context) => {
      const previous = context.state.features;
      features.update(context);
      const nextCoins = context.state.features?.coins ?? {};
      const changed = features.changedCoins(previous?.coins, nextCoins);
      await Promise.all(
        changed.map(async (symbol) => {
          const record: BacktestFeatureRecord = {
            ...nextCoins[symbol],
            t: context.state.currentTime,
          };
          if (spool) {
            await spool.pushFeature(symbol, record);
            return;
          }
          (detectedFeatures[symbol] ??= []).push(record);
        }),
      );
    },
    onNotif: () => true,
  };

  const blackSwanConfig = blackSwan.config.normalize(
    params.config.management.blackSwan,
  );
  const blackSwanSegments: BacktestBlackSwanTransition[] = [];
  if (!isPrecisionChecker && blackSwanConfig.enabled) {
    adapter.onRiskSentinel = backtestBlackSwan.riskSentinel.create({
      onState: (next) => {
        const last = blackSwanSegments[blackSwanSegments.length - 1];
        if (last?.status !== next.status) {
          blackSwanSegments.push({
            reason: next.reason,
            status: next.status,
            t: next.t,
          });
        }
      },
    });
  }

  // The configured strategy module plugs producers/guard/bookkeeping into
  // the same engine — absent means the built-in default pipeline.
  const strategy = await strategies.resolve(
    params.config.management.strategy,
  );
  const engine = new RuntimeEngine(state, adapter, strategy);
  await engine.start();
  await captureBalance();

  const blackSwanTimeline: BacktestBlackSwanTimeline | undefined =
    isPrecisionChecker
      ? undefined
      : {
          enabled: blackSwanConfig.enabled,
          endTime,
          segments: blackSwanSegments,
          startTime: currentTime,
        };

  if (spool) {
    for (const position of state.openPositions) {
      stats.onOpen();
      await spool.pushPosition(position);
    }
    const parts = await spool.finalize();
    return {
      blackSwanTimeline,
      counts: stats.counts(),
      dataset: { endTime, startTime: datasetStartTime },
      exchangeType: params.config.management.exchangeType,
      parts,
      summary: stats.summary(),
    };
  }

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
    blackSwanTimeline,
    exchangeType: params.config.management.exchangeType,
    vPointsMap: resultVPointsMap,
    positions: [...history, ...state.openPositions],
    balanceSnapshots,
    featuresMap: detectedFeatures,
  };
}
