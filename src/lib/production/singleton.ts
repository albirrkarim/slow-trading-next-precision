import factory from "./factory";
import runtime, { type ProductionRuntime } from "./runtime";

const globalForProduction = globalThis as unknown as {
  precisionProductionRuntime?: ProductionRuntime;
};

/** Returns the process-wide production runtime owner used by instrumentation. */
function getProductionRuntime(): ProductionRuntime {
  const existing = globalForProduction.precisionProductionRuntime;
  if (!existing || typeof existing.captureState !== "function") {
    existing?.stop();
    const nextRuntime = runtime.create();
    globalForProduction.precisionProductionRuntime = nextRuntime;

    if (process.env.NODE_ENV !== "production") {
      void nextRuntime.start(factory.create()).catch((error) => {
        console.error("[Precision Runtime] hot-reload restart failed", error);
      });
    }
  }

  return globalForProduction.precisionProductionRuntime!;
}

const singleton = { get: getProductionRuntime } as const;

export default singleton;
export { getProductionRuntime, singleton };
