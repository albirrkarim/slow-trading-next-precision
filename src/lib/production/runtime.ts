import { RuntimeEngine } from "@/lib/precision";
import type { ProductionRuntimeFactory } from "./types";

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/** Owns one process-level production engine lifecycle and its shutdown signal. */
class ProductionRuntime {
  private controller?: AbortController;
  private runPromise?: Promise<void>;

  /** Starts the engine once; repeated calls share the same in-flight run. */
  start(factory: ProductionRuntimeFactory): Promise<void> {
    if (this.runPromise) return this.runPromise;

    const controller = new AbortController();
    this.controller = controller;

    this.runPromise = (async () => {
      const state = await factory.createState();
      const adapter = await factory.createAdapter({
        signal: controller.signal,
        state,
      });
      if (controller.signal.aborted) return;

      try {
        await new RuntimeEngine(state, adapter).start();
      } catch (error) {
        if (!isAbortError(error)) throw error;
      }
    })().finally(() => {
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
}

const runtime = { create: () => new ProductionRuntime() } as const;

export default runtime;
export { ProductionRuntime, runtime };
