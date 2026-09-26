import systemLog from "../system/logging";
import type {
  RuntimeCycleSectionSummary,
  RuntimeStage,
  RuntimeStageRunStats,
} from "../system/runtime";
import { createRuntimeHelper, type RuntimeHelper } from "./helper";
import monitoring from "./monitoring";
import runtimeErrors from "./utils/errors";
import preview from "./utils/preview";
import runtimeSelfTest from "./utils/on-start-test";
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
export class RuntimeEngine {
  /** Shared runtime snapshot mutated in place by stages, actions, and helpers. */
  state: RuntimeEngineState;

  /** Environment bridge: market data, balance, execution, and lifecycle hooks. */
  adapter: RuntimeEngineAdapter;

  /** Convenience layer over `state` shared with every stage body. */
  helper: RuntimeHelper;

  /**
   * Resolved strategy plug-in; absent means the built-in default pipeline.
   * Carried on every `RuntimeContext` so stages swap decision producers
   * and fire the strategy's observation hooks.
   */
  strategy?: RuntimeContext["strategy"];

  /** True once the first market-data warmup inside `start()` completes. */
  private ready = false;

  /** True while a stage cycle or exclusive task is mutating runtime state. */
  private processing = false;

  /** Serializes stage cycles and operator passes so state updates never interleave. */
  private queue: Promise<unknown> = Promise.resolve();

  /** Wires the shared state and environment adapter into one engine. */
  constructor(
    state: RuntimeEngineState,
    adapter: RuntimeEngineAdapter,
    strategy?: RuntimeContext["strategy"],
  ) {
    this.state = state;
    this.adapter = adapter;
    this.strategy = strategy;
    this.helper = createRuntimeHelper(state, adapter);
  }

  /** Reports whether the warmup inside `start()` has completed. */
  isReady(): boolean {
    return this.ready;
  }

  /** Reports whether a stage cycle or exclusive task is currently running. */
  isProcessing(): boolean {
    return this.processing;
  }

  /**
   * Warms the shared market snapshot, then loops the stage scheduler until the
   * adapter clock finishes. Production waits on wall-clock boundaries; the
   * backtest clock jumps straight to each due candle. A failed cycle is
   * logged and skipped — only an abort error stops the loop.
   */
  async start() {
    if (!this.state.config.runtime.runnerEnabled) {
      return;
    }

    systemLog.info("\n\nRUNTIME ENGINE STARTED");
    systemLog.info(preview.state(this.state));

    // Boot-time strategy validation (e.g. hedge-mode position check) —
    // throws surface to the caller instead of failing mid-cycle.
    await this.strategy?.preflight?.(this.context);

    try {
      // Startup probe: reads one kline batch per symbol through the adapter
      // so a broken market-data path is reported (log + NOTIF_ERROR channels)
      // at boot instead of surfacing as repeated stage failures.
      await runtimeSelfTest.marketData({
        adapter: this.adapter,
        state: this.state,
      });

      // Warmup seeds markPriceMap and vPointsMap so the first stage pass never
      // runs on empty market data.
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
          if (runtimeErrors.isAbort(error)) throw error;
          systemLog.error(
            "[Precision Runtime] cycle failed — engine continues",
            error,
          );
          await runtimeErrors.record("runtime.cycle", error);
        }
      }
    } finally {
      this.ready = false;
      this.processing = false;
    }
  }

  /**
   * Appends one task to the serialized run queue. The queue itself swallows
   * task failures so a rejected pass cannot stall everything queued after it;
   * the caller still receives the task's own promise.
   */
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
      strategy: this.strategy,
    };

    const startedAt = Date.now();
    let patch: RuntimeStageRunPatch | void = undefined;
    let failed: unknown;
    try {
      patch = await body(context);
    } catch (error) {
      if (runtimeErrors.isAbort(error)) throw error;
      failed = error;
      systemLog.error(`[Precision Runtime] ${stage} pass failed`, error);
      await runtimeErrors.record(`runtime.stage.${stage}`, error);
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
          await runtimeErrors.record(`runtime.stats.${stage}`, statsError);
        });
    }

    return { ms, n: 1, s: stage, stats };
  }

  /** Counts distinct symbols across open positions for stage-run stats. */
  private openSymbolCount(): number {
    return new Set(
      this.state.openPositions
        .filter((position) => !position.closed)
        .map((position) => position.symbol),
    ).size;
  }

  /**
   * Dispatches every due stage in a fixed order — risk sentinel, speedup,
   * standard monitoring, management, capture entry — then reports the whole
   * cycle through `onCycleComplete`. Each stage first refreshes the shared
   * market snapshot so position checks and entry capture see one consistent
   * price/volatility view.
   */
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
              // Speedup watches fast moves, so it prepares 1-minute candles
              // instead of the shared 5-minute snapshot.
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

      // Cycle stats aggregate every stage that ran; sections are sorted by
      // duration so the dashboard highlights the slowest stage first.
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
            await runtimeErrors.record("runtime.stats.cycle", cycleError);
          });
      }
    } finally {
      this.processing = false;
    }
  }

  /** Builds the shared context handed to adapter hooks and exclusive tasks. */
  private get context(): RuntimeContext {
    return {
      adapter: this.adapter,
      helper: this.helper,
      state: this.state,
      strategy: this.strategy,
    };
  }
}
