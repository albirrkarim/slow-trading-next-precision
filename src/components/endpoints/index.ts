import { devEndpoints } from "./dev";
import { backtestEndpoints } from "./backtest";
import { precisionEndpoints } from "./precision";
import { slowEndpoints } from "./slow";

/**
 * Grouped endpoint catalog.
 */
const endpoints = {
  backtest: backtestEndpoints,
  precision: precisionEndpoints,
  slow: slowEndpoints,
  dev: devEndpoints,
};

export type Endpoints = typeof endpoints;

export { endpoints };
