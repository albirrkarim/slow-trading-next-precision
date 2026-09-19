import { RuntimeEngineInput } from "./types";

/**
 * This runtime is used on both in backtest and the production
 * BOTH:SHARED_RUNTIME_ENGINE
 */
export function precisionRuntime({ mode, clock, market }: RuntimeEngineInput) {}
