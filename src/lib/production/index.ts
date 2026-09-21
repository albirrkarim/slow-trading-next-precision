import adapter from "./adapter";
import clock from "./clock";
import singleton from "./singleton";
import state from "./state";

/** Grouped production composition API for instrumentation and runtime setup. */
const production = {
  adapter,
  clock,
  runtime: singleton,
  state,
};

export default production;
export { production };
export type {
  ProductionAdapterOptions,
  ProductionMarket,
  ProductionRuntimeFactory,
  ProductionStateOptions,
} from "./types";
