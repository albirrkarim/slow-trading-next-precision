import { MCP_API } from "./constants";
import { devEndpoints } from "./dev";
import { marketEndpoints } from "./market";
import { pinEndpoints } from "./pin";
import { systemEndpoints } from "./system";

/**
 * Grouped endpoint catalog. Key paths mirror URL paths:
 * endpoints.system.balance.refresh ⇔ /api/system/balance/refresh.
 */
const endpoints = {
  system: systemEndpoints,
  market: marketEndpoints,
  dev: devEndpoints,
  pin: pinEndpoints,
  mcp: MCP_API,
};

export type Endpoints = typeof endpoints;

export { endpoints };
