import { devEndpoints } from "./dev";
import { precisionEndpoints } from "./precision";
import { slowEndpoints } from "./slow";

/**
 * Grouped endpoint catalog.
 */
const endpoints = {
  precision: precisionEndpoints,
  slow: slowEndpoints,
  dev: devEndpoints,
};

export type Endpoints = typeof endpoints;

export { endpoints };
