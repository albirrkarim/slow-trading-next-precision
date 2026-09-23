import { RUNTIME_MCP_PERMISSIONS } from "./types";
import runtimeMcpIdentity from "./identity";
import runtimeMcpTokens from "./tokens";
import runtimeMcpTools from "./tools";

const runtimeMcp = {
  identity: runtimeMcpIdentity,
  permissions: RUNTIME_MCP_PERMISSIONS,
  tokens: runtimeMcpTokens,
  tools: runtimeMcpTools,
} as const;

export default runtimeMcp;
export { runtimeMcp };
export { RUNTIME_MCP_PERMISSIONS } from "./types";
export type {
  RuntimeMcpAuthenticatedToken,
  RuntimeMcpToolDefinition,
  RuntimeMcpToolHandler,
} from "./types";
