import type {
  RuntimeMcpPermission,
  RuntimeMcpTokenRecord,
} from "../runtime/types";

/** Every permission flag available to an MCP token. */
export const RUNTIME_MCP_PERMISSIONS: RuntimeMcpPermission[] = [
  "tags.read",
  "tags.write",
  "coin_metadata.read",
  "coin_metadata.write",
  "coin_metadata.broadcast",
  "balance.read",
  "trade_history.read",
  "monitoring.read",
];

export interface RuntimeMcpToolDefinition {
  name: string;
  description: string;
  permission: RuntimeMcpPermission;
  inputSchema: Record<string, unknown>;
  readOnlyHint?: boolean;
}

export interface RuntimeMcpAuthenticatedToken {
  token: RuntimeMcpTokenRecord;
  permissions: Set<RuntimeMcpPermission>;
}

/** One tool invocation resolved through the dispatch registry. */
export type RuntimeMcpToolHandler = (params: {
  args: Record<string, unknown>;
  auth: RuntimeMcpAuthenticatedToken;
}) => Promise<unknown> | unknown;
