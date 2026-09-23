import { RuntimeEngine } from "@/lib/precision";
import type {
  RuntimeContext,
  RuntimeEngineState,
} from "@/lib/precision/types";
import factoryModule from "./factory";
import type { ProductionRuntimeFactory } from "./types";

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

const READY_WAIT_MS = 100;
const READY_WAIT_ATTEMPTS = 100;

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

  /** Starts the engine once; repeated calls share the same in-flight run. */
  start(factory: ProductionRuntimeFactory): Promise<void> {
    if (this.runPromise) return this.runPromise;

    const controller = new AbortController();
    this.controller = controller;
    this.factory = factory;

    this.runPromise = (async () => {
      const state = await factory.createState();
      this.state = state;
      const adapter = await factory.createAdapter({
        signal: controller.signal,
        state,
      });
      if (controller.signal.aborted) return;

      try {
        const engine = new RuntimeEngine(state, adapter);
        this.engine = engine;
        await engine.start();
      } catch (error) {
        if (!isAbortError(error)) throw error;
      }
    })().finally(() => {
      this.engine = undefined;
      this.controller = undefined;
      this.runPromise = undefined;
    });

    return this.runPromise;
  }

  /** Stops the current production engine and lets its clock exit cleanly. */
  stop(): void {
    this.controller?.abort();
  }

  /** Reports whether a production engine is currently running. */
  isRunning(): boolean {
    return this.runPromise !== undefined;
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
