import runtimeDashboard from "../dashboard";
import runtimeMcpAccountScope from "./account-scope";
import runtimeMcpBalanceSummary, {
  type RuntimeMcpBalanceSummary,
} from "./balance-summary";

// PROD:MCP_BALANCE
// PROD:MULTI_ACCOUNT_COMBINED_MCP_BALANCE

interface RuntimeMcpBalanceReadParams {
  instanceName: string;
  requestedMode: unknown;
}

/** Reads and combines the requested balance mode across every enabled account. */
async function read(
  params: RuntimeMcpBalanceReadParams,
): Promise<RuntimeMcpBalanceSummary> {
  const scope = await runtimeMcpAccountScope.resolve({
    defaultMode: "active",
    requestedMode: params.requestedMode,
  });

  const dashboardState = await runtimeDashboard.state.buildCombined({
    mode: scope.mode,
  });

  return runtimeMcpBalanceSummary.create({
    activeMode: scope.activeMode,
    dashboardState,
    instanceName: params.instanceName,
    mode: scope.mode,
  });
}

const runtimeMcpBalance = { read } as const;

export default runtimeMcpBalance;
