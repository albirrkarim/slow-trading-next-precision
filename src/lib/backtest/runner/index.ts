import fs from "fs-extra";

import { FILES } from "@/components/storage";
import { clearExchangeFactoryOverride, setExchangeFactoryOverride } from "@/lib/exchange";
import type {
  PrecisionBacktestResultV1,
  ProdTestCaseV1,
} from "@/lib/precision/types";
import type { Position } from "@/lib/trading/models";
import slowTradingBlackSwan from "@/lib/runtime/black-swan";
import slowTradingCycle from "@/lib/runtime/cycle";
import slowTradingManagement from "@/lib/runtime/management";
import slowTradingQueue from "@/lib/runtime/queue";
import slowTradingStages from "@/lib/runtime/stages";
import slowTradingStorage from "@/lib/runtime/storage";
import slowTradingJsonFile from "@/lib/runtime/storage/json-file";
import type { SlowTradingStage } from "@/lib/runtime/types";
import type { BacktestDatasetV1 } from "../dataset";
import { BacktestExchange } from "../exchange";
import { BacktestMetricsRecorder } from "../metrics";

const MINUTE_MS = 60_000;

/** Progress report emitted after every simulated logical minute. */
export interface BacktestRunProgress {
  currentTime: number;
  processedMinutes: number;
  totalMinutes: number;
  message?: string;
}

export interface RunPrecisionBacktestParams {
  dataset: BacktestDatasetV1;
  testCase: ProdTestCaseV1;
  /** Absolute directory the result JSON is written into. */
  outputDir: string;
  /**
   * Isolated persistent-storage root the driver process must have set
   * before importing this module. The runner refuses to run otherwise.
   */
  storageRoot: string;
  /** Deterministic slippage in percentage points applied to every fill. */
  slippagePct?: number;
  signal?: AbortSignal;
  onProgress?: (progress: BacktestRunProgress) => void;
}

/** Deep-copies one JSON value. */
function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Disables every notification channel so a backtest never sends messages. */
function disableNotifications(runtime: {
  notification?: {
    telegram?: { enabled?: boolean };
    email?: { enabled?: boolean };
  };
}): void {
  runtime.notification ??= {};
  runtime.notification.telegram ??= { enabled: false } as never;
  runtime.notification.email ??= { enabled: false } as never;
  runtime.notification.telegram.enabled = false;
  runtime.notification.email.enabled = false;
}

/** Seeds the isolated storage from one production test case. */
async function seedStorage(params: { testCase: ProdTestCaseV1 }) {
  const { testCase } = params;
  const base = slowTradingStorage.data.createDefault();
  const runtime = cloneJson(testCase.config.runtime);
  runtime.runnerEnabled = true;
  runtime.sandboxEnabled = testCase.mode === "sandbox";
  disableNotifications(runtime);

  const account =
    runtime.exchangeAccounts.find(
      (candidate) => candidate.slug === testCase.account,
    ) ?? runtime.exchangeAccounts[0];
  if (!account) {
    throw new Error(
      `Test case account ${testCase.account} is not in the captured runtime accounts`,
    );
  }

  const config = cloneJson(testCase.config.trading);
  const storage = {
    ...base,
    account,
    config,
    runtime,
    modes: {
      live: base.modes.live,
      sandbox: base.modes.sandbox,
      [testCase.mode]: slowTradingStorage.mode.ensureTradeSettings(
        cloneJson(testCase.initialState),
        config.symbols,
      ),
    },
    updatedAt: Date.now(),
  };
  await slowTradingStorage.data.save(storage);

  for (const [symbol, memory] of Object.entries(
    testCase.sharedVolatility ?? {},
  )) {
    await slowTradingJsonFile.write.atomic(
      `${FILES.slow.volatility(config.exchangeType)}/${symbol}.json`,
      memory,
    );
  }
}

/**
 * Runs one due stage exactly like the production runner tick, without real
 * waiting, cooldowns, or notifications.
 */
async function runStage(params: {
  stage: SlowTradingStage;
  storage: Awaited<ReturnType<typeof slowTradingStorage.data.load>>;
}): Promise<void> {
  const { stage, storage } = params;

  if (stage === "risk-sentinel") {
    // PROD:BLACK_SWAN_SHARED_EVIDENCE
    const evidence = await slowTradingBlackSwan.evidence.capture({ storage });
    // PROD:MULTI_ACCOUNT_SEQUENTIAL_CYCLE
    for (const account of storage.runtime.exchangeAccounts) {
      // PROD:BLACK_SWAN_ACCOUNT_STATE_FAN_OUT
      const result = await slowTradingBlackSwan.account.apply({
        account: account.slug,
        evidence,
      });
      if (result.forceExitSymbols.length > 0) {
        await slowTradingCycle.run({
          account: account.slug,
          disableAutoEntry: true,
          forceExitSymbols: result.forceExitSymbols,
          ignoreRunnerEnabled: true,
        });
      }
    }
    return;
  }

  if (stage === "management") {
    await slowTradingManagement.run();
    return;
  }

  if (stage === "capture-entry") {
    for (const account of storage.runtime.exchangeAccounts) {
      await slowTradingQueue.scheduler.synchronize(
        Date.now(),
        account.slug,
      );
    }
    await slowTradingQueue.processor.processDue();
  }

  await slowTradingCycle.run({ bypass: false, stage });
}

/** Converts one persisted position into the canonical V1 precision shape. */
function canonicalizePosition(
  position: Position,
): ProdTestCaseV1["endPositions"][number] {
  return {
    ...position,
    strategyId: "multi",
  };
}

/** Collects the final form of every position open at start or closed during the run. */
async function collectEndPositions(params: {
  testCase: ProdTestCaseV1;
}): Promise<ProdTestCaseV1["endPositions"]> {
  const { testCase } = params;
  const storage = await slowTradingStorage.data.load({
    account: testCase.account,
    modeScope: "all",
  });
  const modeState = storage.modes[testCase.mode];
  const openPositions = modeState.tradeSettings.flatMap((tradeSetting) =>
    (tradeSetting.model_memory.positions ?? []).map(canonicalizePosition),
  );
  const closedHistory = await slowTradingStorage.history.readAccounts({
    accountSlugs: [testCase.account],
    mode: testCase.mode,
  });
  const closedPositions = closedHistory
    .filter((position) => {
      const closedAt = position.closed?.t;
      return (
        typeof closedAt === "number" &&
        Number.isFinite(closedAt) &&
        closedAt >= testCase.startTime &&
        closedAt <= testCase.endTime
      );
    })
    .map((position) => {
      const { mode: _historyMode, ...rest } = position;
      return canonicalizePosition(rest);
    });

  return [...openPositions, ...closedPositions].sort(
    (left, right) => left.opened.t - right.opened.t,
  );
}

/**
 * Executes one precision backtest through the shared production runtime.
 *
 * The caller (driver process) must set `PERSISTENT_STORAGE_ROOT` to an
 * isolated temp directory before importing this module. The runner installs
 * a dataset-backed exchange adapter and a logical clock, then ticks every
 * production stage at its configured cadence from startTime to endTime.
 */
export async function runPrecisionBacktest(
  params: RunPrecisionBacktestParams,
): Promise<{ fileName: string; result: PrecisionBacktestResultV1 }> {
  const { dataset, testCase } = params;
  if (process.env.PERSISTENT_STORAGE_ROOT !== params.storageRoot) {
    throw new Error(
      "Backtest requires PERSISTENT_STORAGE_ROOT to point at the isolated storage root",
    );
  }

  // The dataset must cover the run window plus the shared volatility warmup.
  const sharedVolatilityStarts = Object.values(
    testCase.sharedVolatility ?? {},
  )
    .map((memory) => memory.lastVolatility?.at(-1)?.t)
    .filter((time): time is number => Number.isFinite(time));
  const requiredWarmupStart = Math.min(
    testCase.startTime,
    ...(sharedVolatilityStarts.length > 0
      ? sharedVolatilityStarts
      : [testCase.startTime]),
  );
  if (dataset.warmupStartTime > requiredWarmupStart) {
    throw new Error(
      `Dataset warmup starts at ${dataset.warmupStartTime} but the test case needs candles from ${requiredWarmupStart}`,
    );
  }

  await seedStorage({ testCase });

  let logicalTime = testCase.startTime;
  const metrics = new BacktestMetricsRecorder(() => logicalTime);
  const startingQuoteAsset =
    testCase.initialState.dynamicTradeMemory?.quoteAsset ??
    testCase.config.runtime.sandboxInitialBalanceUSDT ??
    1000;
  const exchange = new BacktestExchange({
    dataset,
    clock: { now: () => logicalTime },
    startingQuoteAsset,
    slippagePct: params.slippagePct,
    metrics,
  });

  const originalDateNow = Date.now;
  const originalSetTimeout = global.setTimeout;
  Date.now = () => logicalTime;
  // Eliminate production pacing delays while preserving async semantics.
  global.setTimeout = ((handler: unknown, _timeout?: number, ...rest: unknown[]) =>
    originalSetTimeout(handler as never, 0, ...(rest as never[]))) as typeof global.setTimeout;
  setExchangeFactoryOverride(() => exchange);

  try {
    const firstTick =
      Math.floor(testCase.startTime / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
    const totalMinutes = Math.max(
      0,
      Math.ceil((testCase.endTime - firstTick) / MINUTE_MS),
    );
    let processedMinutes = 0;

    // TC: BOTH:RUNTIME_SCHEDULING
    for (
      let tick = firstTick;
      tick <= testCase.endTime;
      tick += MINUTE_MS
    ) {
      params.signal?.throwIfAborted();
      logicalTime = tick;
      const storage = await slowTradingStorage.data.load({
        account: testCase.account,
        modeScope: "active",
      });
      const epochMinute = Math.floor(tick / MINUTE_MS);
      for (const stage of slowTradingStages.order) {
        const intervalMinutes = slowTradingStages.interval.getMinutes(
          storage.runtime,
          stage,
        );
        if (epochMinute % intervalMinutes !== 0) {
          continue;
        }
        await metrics.trackStage(stage, () => runStage({ stage, storage }));
      }

      processedMinutes += 1;
      params.onProgress?.({
        currentTime: tick,
        processedMinutes,
        totalMinutes,
      });
    }
  } finally {
    clearExchangeFactoryOverride();
    global.setTimeout = originalSetTimeout;
    Date.now = originalDateNow;
  }

  const endPositions = await collectEndPositions({ testCase });
  const result = {
    schema: 1 as const,
    strategy: testCase.strategy,
    mode: "backtest" as const,
    account: testCase.account,
    startTime: testCase.startTime,
    endTime: testCase.endTime,
    config: testCase.config,
    initialState: testCase.initialState,
    sharedVolatility: testCase.sharedVolatility,
    endPositions,
    metrics: metrics.snapshot({
      logicalDurationMs: testCase.endTime - testCase.startTime,
    }),
  };

  const fileName = `backtest-${testCase.startTime}-${testCase.endTime}.json`;
  await fs.ensureDir(params.outputDir);
  await slowTradingJsonFile.write.atomic(
    `${params.outputDir}/${fileName}`,
    result,
  );

  return { fileName, result };
}

const slowTradingBacktestRunner = {
  run: runPrecisionBacktest,
} as const;

export default slowTradingBacktestRunner;
export { slowTradingBacktestRunner };
