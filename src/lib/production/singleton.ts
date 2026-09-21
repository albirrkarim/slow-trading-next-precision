import runtime, { type ProductionRuntime } from "./runtime";

const globalForProduction = globalThis as unknown as {
  precisionProductionRuntime?: ProductionRuntime;
};

/** Returns the process-wide production runtime owner used by instrumentation. */
function getProductionRuntime(): ProductionRuntime {
  if (!globalForProduction.precisionProductionRuntime) {
    globalForProduction.precisionProductionRuntime = runtime.create();
  }

  return globalForProduction.precisionProductionRuntime;
}

const singleton = { get: getProductionRuntime } as const;

export default singleton;
export { getProductionRuntime, singleton };
