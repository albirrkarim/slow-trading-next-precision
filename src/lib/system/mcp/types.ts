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
  "engine_state.read",
  "backtest.read",
  "backtest.run",
  "backtest.leaderboard.write",
];

export interface RuntimeMcpToolDefinition {
  name: string;
  description: string;
  permission: RuntimeMcpPermission;
  inputSchema: Record<string, unknown>;
  readOnlyHint?: boolean;
  /**
   * Dev-instance-only tool: stays listed for discovery, but tools/call
   * returns a warning payload instead of dispatching when the composition
   * root reports dev tooling disabled.
   */
  devOnly?: boolean;
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
