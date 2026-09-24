import { RuntimeEngine } from "@/lib/precision";
import type {
  RuntimeContext,
  RuntimeEngineAdapter,
  RuntimeEngineState,
} from "@/lib/precision/types";
import { systemLog } from "@/lib/system/logging";
import { runtimeStages } from "@/lib/system/runtime";
import { runtimeLogs, runtimeStorage } from "@/lib/system/storage";
import coinManagement from "./coin-management";
import factoryModule from "./factory";
import type { ProductionRuntimeFactory } from "./types";

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

const MINUTE_MS = 60_000;
const READY_WAIT_MS = 100;
const READY_WAIT_ATTEMPTS = 100;
const RESTART_BASE_MS = 30_000;
const RESTART_MAX_MS = 5 * 60_000;
/** Crashes after this uptime count as a healthy engine that hit a fault. */
const HEALTHY_RUN_MS = 10 * 60_000;
/** Poll cadence for the out-of-queue coin-management pass. */
const COIN_MANAGEMENT_TICK_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Owns one process-level production engine lifecycle and its shutdown signal. */
class ProductionRuntime {
  private controller?: AbortController;
  private factory?: ProductionRuntimeFactory;
  private runPromise?: Promise<void>;
  private state?: RuntimeEngineState;
  private engine?: RuntimeEngine;
  private adapter?: RuntimeEngineAdapter;
  private restartTimer?: ReturnType<typeof setTimeout>;
  private restartAttempts = 0;
  private startedAt = 0;
  private coinManagementTimer?: ReturnType<typeof setInterval>;
  private coinManagementRunning = false;
  private lastCoinManagementBoundary = -1;

  /** Starts the engine once; repeated calls share the same in-flight run. */
  start(factory: ProductionRuntimeFactory): Promise<void> {
    if (this.runPromise) return this.runPromise;

    clearTimeout(this.restartTimer);
    this.restartTimer = undefined;

    const controller = new AbortController();
    this.controller = controller;
    this.factory = factory;
    this.startedAt = Date.now();

    this.runPromise = (async () => {
      const state = await factory.createState();
      this.state = state;
      const adapter = await factory.createAdapter({
        signal: controller.signal,
        state,
      });
      if (controller.signal.aborted) return;
      this.adapter = adapter;
      this.startCoinManagementLoop();

      try {
        const engine = new RuntimeEngine(state, adapter);
        this.engine = engine;
        await engine.start();
      } catch (error) {
        if (!isAbortError(error)) throw error;
      }
    })().finally(() => {
      this.engine = undefined;
      this.adapter = undefined;
      this.controller = undefined;
      this.runPromise = undefined;
    });

    // Supervisor: an unexpected exit (bootstrap fault or a failure that
    // escaped the stage guards) is recorded, then schedules a restart with
    // capped backoff. A stop() abort or a clean clock finish never restarts.
    this.runPromise.catch(async (error) => {
      if (controller.signal.aborted || isAbortError(error)) return;
      await runtimeLogs
        ?.appendError?.({ source: "runtime.engine", error })
        ?.catch(() => undefined);
      // An engine that stayed up long enough gets a fresh backoff budget.
      if (Date.now() - this.startedAt > HEALTHY_RUN_MS) {
        this.restartAttempts = 0;
      }
      this.scheduleRestart();
    });

    return this.runPromise;
  }

  /** Schedules the next engine restart with exponential backoff. */
  private scheduleRestart() {
    if (this.restartTimer || !this.factory) return;
    const delayMs = Math.min(
      RESTART_BASE_MS * 2 ** this.restartAttempts,
      RESTART_MAX_MS,
    );
    this.restartAttempts += 1;
    systemLog.error(
      `[Precision Runtime] scheduling engine restart in ${Math.round(
        delayMs / 1000,
      )}s (attempt ${this.restartAttempts})`,
    );
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      const factory = this.factory;
      if (factory) void this.start(factory);
    }, delayMs);
  }

  /**
   * Arms the coin auto-removal pass on the independently configured
   * management cadence. Its data evaluation runs outside the engine's
   * serialized stage queue; only the short commit enters `runExclusive`.
   */
  private startCoinManagementLoop() {
    if (this.coinManagementTimer) return;
    this.coinManagementTimer = setInterval(() => {
      void this.tickCoinManagement().catch(async (error) => {
        systemLog.error(
          "[Precision Runtime] coin-management pass failed",
          error,
        );
        await runtimeLogs
          .appendError({
            source: "management-cycle.auto-remove",
            error,
          })
          .catch(() => undefined);
      });
    }, COIN_MANAGEMENT_TICK_MS);
    this.coinManagementTimer.unref?.();
  }

  /** Runs the auto-removal pass once per management boundary while live. */
  private async tickCoinManagement() {
    if (this.coinManagementRunning) return;
    const engine = this.engine;
    const adapter = this.adapter;
    if (!engine?.isReady() || !adapter) return;

    const catalog = await runtimeStorage.catalog
      .load()
      .catch(() => undefined);
    const runtimeConfig = catalog?.config.runtime;
    if (!catalog || !runtimeConfig?.runnerEnabled) return;

    const intervalMinutes = runtimeStages.interval.getMinutes(
      runtimeConfig,
      "management",
    );
    const now = Date.now();
    if (Math.floor(now / MINUTE_MS) % intervalMinutes !== 0) return;
    const boundary = Math.floor(now / (intervalMinutes * MINUTE_MS));
    if (boundary === this.lastCoinManagementBoundary) return;
    this.lastCoinManagementBoundary = boundary;

    this.coinManagementRunning = true;
    try {
      await coinManagement.run({
        getKlines: (params) => adapter.market.getKlines(params),
        runExclusive: (task) => engine.runExclusive(task),
      });
    } finally {
      this.coinManagementRunning = false;
    }
  }

  /** Stops the current production engine and lets its clock exit cleanly. */
  stop(): void {
    clearTimeout(this.restartTimer);
    this.restartTimer = undefined;
    this.restartAttempts = 0;
    clearInterval(this.coinManagementTimer);
    this.coinManagementTimer = undefined;
    this.lastCoinManagementBoundary = -1;
    this.controller?.abort();
  }

  /** Reports whether a production engine is currently running. */
  isRunning(): boolean {
    return this.runPromise !== undefined;
  }

  /** Reports the managed engine's lifecycle flags and the restart supervisor. */
  status(): {
    processing: boolean;
    ready: boolean;
    restartPending: boolean;
    running: boolean;
  } {
    return {
      processing: this.engine?.isProcessing() ?? false,
      ready: this.engine?.isReady() ?? false,
      restartPending: this.restartTimer !== undefined,
      running: this.isRunning(),
    };
  }

  /** Returns the mutable state owned by the currently loaded runtime. */
  getState(): RuntimeEngineState | undefined {
    return this.state;
  }

  /**
   * Runs an operator-initiated task serialized with the engine's scheduled
   * stages. When the live engine is unavailable — runner disabled or never
   * started — the task still executes on a one-shot engine over the persisted
   * state so manual entry/exit/run always reach the exchange.
   */
  async runManual<T>(
    task: (context: RuntimeContext) => Promise<T>,
    options?: { overrideRunnerGate?: boolean },
  ): Promise<T> {
    // Wait briefly while start() finishes bootstrapping so the manual pass
    // joins the live engine instead of building a second state writer.
    for (
      let attempt = 0;
      attempt < READY_WAIT_ATTEMPTS &&
      this.runPromise &&
      !this.engine?.isReady();
      attempt += 1
    ) {
      await sleep(READY_WAIT_MS);
    }

    if (this.engine?.isReady()) {
      return this.engine.runExclusive(task);
    }

    if (this.factory && this.state) {
      // The engine stopped after loading state (e.g. runnerEnabled is off):
      // the operator's explicit pass overrides the runner gate only.
      if (options?.overrideRunnerGate) {
        this.state.config.runtime.runnerEnabled = true;
      }
      const adapter = await this.factory.createAdapter({
        signal: new AbortController().signal,
        state: this.state,
      });
      return new RuntimeEngine(this.state, adapter).runExclusive(task);
    }

    const factory = factoryModule.create();
    const state = await factory.createState();
    if (options?.overrideRunnerGate) {
      state.config.runtime.runnerEnabled = true;
    }
    const adapter = await factory.createAdapter({
      signal: new AbortController().signal,
      state,
    });
    return new RuntimeEngine(state, adapter).runExclusive(task);
  }

  /**
   * Synchronously clones the live engine state for a precision test case.
   * The checks and the clone cannot interleave with a trading stage.
   */
  captureState(): RuntimeEngineState {
    if (!this.state || !this.engine?.isReady()) {
      throw new Error(
        "Production runtime is not ready for a precision snapshot.",
      );
    }
    if (this.engine.isProcessing()) {
      throw new Error(
        "Production runtime is processing a trading stage. Try again after the stage completes.",
      );
    }
    return structuredClone(this.state);
  }
}

const runtime = { create: () => new ProductionRuntime() } as const;

export default runtime;
export { ProductionRuntime, runtime };
