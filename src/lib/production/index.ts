import adapter from "./adapter";
import clock from "./clock";
import factory from "./factory";
import manual from "./manual";
import singleton from "./singleton";
import state from "./state";
import precisionTestCase from "./precision-test-case";

/** Grouped production composition API for instrumentation and runtime setup. */
const production = {
  adapter,
  clock,
  factory,
  manual,
  runtime: singleton,
  state,
  precisionTestCase,
};

export default production;
export { production };
export type { RuntimeManualPassResult } from "./manual";
export type {
  ProductionAdapterOptions,
  ProductionMarket,
  ProductionRuntimeFactory,
  ProductionStateOptions,
} from "./types";
export type {
  PrecisionTestCase,
  PrecisionTestCaseMode,
  PrecisionTestCaseRecordingState,
  PrecisionTestCaseResult,
  PrecisionTestCaseStatus,
} from "./precision-test-case";
