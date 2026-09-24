import systemLog from "../system/logging";
import type {
  RuntimeCycleSectionSummary,
  RuntimeStage,
  RuntimeStageRunStats,
} from "../system/runtime";
import { runtimeLogs } from "../system/storage";
import { createRuntimeHelper, type RuntimeHelper } from "./helper";
import monitoring from "./monitoring";
import preview from "./utils/preview";
import type {
  RuntimeContext,
  RuntimeEngineAdapter,
  RuntimeEngineState,
  RuntimeStageRunPatch,
} from "./types";

/**
 * This runtime is used on both in backtest and the production
 * BOTH:SHARED_RUNTIME_ENGINE
 */
function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/** Persists a stage/cycle failure to the error log without breaking the loop. */
async function recordRuntimeError(source: string, error: unknown) {
  await runtimeLogs
    ?.appendError?.({ source, error })
    ?.catch(() => undefined);
}

export class RuntimeEngine {
  state: RuntimeEngineState;

  adapter: RuntimeEngineAdapter;

  helper: RuntimeHelper;

  private ready = false;

  private processing = false;

  private queue: Promise<unknown> = Promise.resolve();

  constructor(state: RuntimeEngineState, adapter: RuntimeEngineAdapter) {
    this.state = state;
    this.adapter = adapter;
    this.helper = createRuntimeHelper(state, adapter);
  }

  isReady(): boolean {
    return this.ready;
  }

  isProcessing(): boolean {
    return this.processing;
  }

  async start() {
    if (!this.state.config.runtime.runnerEnabled) {
      return;
    }

    systemLog.info("\n\nRUNTIME ENGINE STARTED");
    systemLog.info(preview.state(this.state));

    try {
      await this.helper.market.updateMarkPrice();
      await this.helper.market.updateVPointsMap();
      this.ready = true;

      const clock = this.adapter.clock;

      while (!(await clock.finished())) {
        try {
          const nextTime = monitoring.schedule.getNextTime(
            this.state,
            this.adapter,
          );

          await clock.advanceTo(nextTime);

          this.state.currentTime = clock.now();

          await this.enqueue(() => this.runDueStages());
        } catch (error) {
          // Shutdown still propagates; every other failure keeps the loop alive
          // so one bad pass can never permanently stop the engine.
          if (isAbortError(error)) throw error;
          systemLog.error(
            "[Precision Runtime] cycle failed — engine continues",
            error,
          );
          await recordRuntimeError("runtime.cycle", error);
        }
      }
    } finally {
      this.ready = false;
      this.processing = false;
    }
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /**
   * Serializes an operator-initiated operation with the scheduled stage loop
   * so manual passes and engine stages never interleave on shared state.
   */
  async runExclusive<T>(
    task: (context: RuntimeContext) => Promise<T>,
  ): Promise<T> {
    return this.enqueue(async () => {
      this.processing = true;
      try {
        return await task(this.context);
      } finally {
        this.processing = false;
      }
    });
  }

  /**
   * Runs one stage while counting the positions its actions produced and
   * measuring its wall-clock duration for the persisted run stats. A thrown
   * stage body is recorded as a failed pass instead of aborting the cycle —
   * transient exchange errors (e.g. a Binance rate-limit cooldown) must never
   * kill the engine loop.
   */
  private async runStage(
    stage: RuntimeStage,
    symbols: number,
    body: (
      context: RuntimeContext,
    ) => Promise<RuntimeStageRunPatch | void>,
  ): Promise<RuntimeCycleSectionSummary & { stats: RuntimeStageRunStats }> {
    const adapter = this.adapter;
    let reports = 0;
    const context: RuntimeContext = {
      adapter: {
        ...adapter,
        onAction: async (decision, actionContext) => {
          const position = await adapter.onAction(decision, actionContext);
          if (position) reports += 1;
          return position;
        },
      },
      helper: this.helper,
      state: this.state,
    };

    const startedAt = Date.now();
    let patch: RuntimeStageRunPatch | void = undefined;
    let failed: unknown;
    try {
      patch = await body(context);
    } catch (error) {
      if (isAbortError(error)) throw error;
      failed = error;
      systemLog.error(`[Precision Runtime] ${stage} pass failed`, error);
      await recordRuntimeError(`runtime.stage.${stage}`, error);
    }
    const ms = Date.now() - startedAt;
    const stats: RuntimeStageRunStats = {
      ms,
      performance: {
        sections: [{ ms, n: 1, s: stage }],
        totalMs: ms,
      },
      reports: patch?.reports ?? reports,
      summary: failed
        ? `${stage} pass failed: ${
            failed instanceof Error ? failed.message : String(failed)
          }`
        : (patch?.summary ?? `${stage} pass completed`),
      symbols: patch?.symbols ?? symbols,
      t: this.state.currentTime,
    };

    if (adapter.onStageStats) {
      // Stats persistence is adapter-owned; a write failure must not kill the
      // engine either.
      await adapter
        .onStageStats(stage, stats, this.context)
        .catch(async (statsError) => {
          systemLog.error(
            `[Precision Runtime] failed to record ${stage} stats`,
            statsError,
          );
          await recordRuntimeError(`runtime.stats.${stage}`, statsError);
        });
    }

    return { ms, n: 1, s: stage, stats };
  }

  private openSymbolCount(): number {
    return new Set(
      this.state.openPositions
        .filter((position) => !position.closed)
        .map((position) => position.symbol),
    ).size;
  }

  private async runDueStages() {
    this.processing = true;
    const stages: Awaited<ReturnType<RuntimeEngine["runStage"]>>[] = [];

    try {
      if (
        this.adapter.onRiskSentinel &&
        monitoring.schedule.isRiskSentinelDue(this.state)
      ) {
        stages.push(
          await this.runStage("risk-sentinel", 0, (context) =>
            this.adapter.onRiskSentinel!(context),
          ),
        );
      }

      // BOTH:SPEEDUP_STAGE — same dispatch in live, sandbox, and backtest;
      // production evaluates the wall clock, backtest evaluates candle time.
      if (monitoring.schedule.isSpeedupDue(this.state)) {
        stages.push(
          await this.runStage(
            "speedup",
            this.openSymbolCount(),
            async (context) => {
              await this.helper.market.updateMarkPrice("1m");
              await this.helper.market.updateVPointsMap("1m");
              await monitoring.stages.speedup(context);
            },
          ),
        );
      }

      // BOTH:STANDARD_MONITORING_STAGE
      if (monitoring.schedule.isStandardDue(this.state)) {
        stages.push(
          await this.runStage(
            "standard-monitoring",
            this.openSymbolCount(),
            async (context) => {
              // BOTH:MULTI_ACCOUNT_SHARED_MARKET_PREPARATION — one shared
              // market snapshot per stage serves every account's positions.
              await this.helper.market.updateMarkPrice();
              await this.helper.market.updateVPointsMap();
              await monitoring.stages.standard(context);
            },
          ),
        );
      }

      if (
        this.adapter.onManagement &&
        monitoring.schedule.isManagementDue(this.state)
      ) {
        stages.push(
          await this.runStage("management", 0, (context) =>
            this.adapter.onManagement!(context),
          ),
        );
      }

      // BOTH:CAPTURE_ENTRY_STAGE — the shared entry path in every mode.
      if (monitoring.schedule.isCaptureEntryDue(this.state)) {
        stages.push(
          await this.runStage(
            "capture-entry",
            Object.keys(this.state.vPointsMap).length,
            async (context) => {
              await this.helper.market.updateMarkPrice();
              await this.helper.market.updateVPointsMap();
              await monitoring.entry.capture(context);
            },
          ),
        );
      }

      if (stages.length > 0 && this.adapter.onCycleComplete) {
        const totalMs = stages.reduce(
          (total, stage) => total + stage.ms,
          0,
        );
        const sections = stages.map((stage) => ({
          ms: stage.ms,
          n: stage.n,
          s: stage.s,
        }));
        await this.adapter
          .onCycleComplete(
            {
              ms: totalMs,
              performance: {
                sections: [...sections].sort((left, right) => right.ms - left.ms),
                totalMs,
              },
              reports: stages.reduce(
                (total, stage) => total + stage.stats.reports,
                0,
              ),
              summary: `${stages.length} stage(s) completed`,
              symbols: stages.reduce(
                (total, stage) => total + stage.stats.symbols,
                0,
              ),
              t: this.state.currentTime,
            },
            this.context,
          )
          .catch(async (cycleError) => {
            systemLog.error(
              "[Precision Runtime] failed to record cycle stats",
              cycleError,
            );
            await recordRuntimeError("runtime.stats.cycle", cycleError);
          });
      }
    } finally {
      this.processing = false;
    }
  }

  private get context(): RuntimeContext {
    return {
      adapter: this.adapter,
      helper: this.helper,
      state: this.state,
    };
  }

  updateBalance() {
    // foreach accounts
    // const balanceAccount = this.exchange.getBalance;
  }

  // used in production
  updateConfig() {
    // update config to the state and storage
  }
}
