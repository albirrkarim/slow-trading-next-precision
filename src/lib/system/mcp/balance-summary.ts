import type { RuntimeMode } from "../storage/runtime";
import type {
  RuntimeDashboardAccountSummary,
  RuntimeDashboardState,
} from "../dashboard/types";

// PROD:MCP_BALANCE

export interface RuntimeMcpBalance {
  available: number;
  currency: "USDT";
  locked: number;
  reserved: number;
  safeHaven: number;
  spendable: number;
  totalAsset: number;
}

export interface RuntimeMcpAccountBalanceSummary {
  balance: RuntimeMcpBalance;
  mode: RuntimeMode;
  name: string;
  slug: RuntimeDashboardAccountSummary["slug"];
}

export interface RuntimeMcpBalanceSummary {
  accounts: RuntimeMcpAccountBalanceSummary[];
  activeMode: RuntimeMode;
  balance: RuntimeMcpBalance;
  equations: {
    available: string;
    spendable: string;
    totalAsset: string;
  };
  generatedAt: string;
  instanceName: string;
  meanings: Record<keyof RuntimeMcpBalanceSummary["balance"], string>;
  mode: RuntimeMode;
  source: "live_exchange_with_persisted_fallback" | "sandbox_simulation";
  sourceMeaning: string;
}

function roundUsdt(value: number): number {
  return Number((Number.isFinite(value) ? value : 0).toFixed(6));
}

/** Converts dashboard balance fields into the canonical MCP balance object. */
function createBalance(
  balances: RuntimeDashboardState["balances"],
): RuntimeMcpBalance {
  return {
    available: roundUsdt(balances.availableQuoteAsset),
    currency: "USDT",
    locked: roundUsdt(balances.lockedQuoteAsset),
    reserved: roundUsdt(balances.reservedQuoteAsset),
    safeHaven: roundUsdt(balances.safeHaven),
    spendable: roundUsdt(balances.spendableQuoteAsset),
    totalAsset: roundUsdt(
      balances.availableQuoteAsset + balances.lockedQuoteAsset,
    ),
  };
}

/** Creates an agent-readable balance contract from the canonical dashboard balance state. */
function createBalanceSummary(params: {
  activeMode: RuntimeMode;
  dashboardState: RuntimeDashboardState;
  generatedAt?: Date;
  instanceName: string;
  mode: RuntimeMode;
}): RuntimeMcpBalanceSummary {
  const balances = params.dashboardState.balances;

  return {
    accounts: (params.dashboardState.accountSummaries ?? []).map((account) => ({
      balance: createBalance(account.balances),
      mode: account.activeMode,
      name: account.name,
      slug: account.slug,
    })),
    activeMode: params.activeMode,
    balance: createBalance(balances),
    equations: {
      available: "available = spendable + reserved + safeHaven",
      spendable: "spendable = max(0, available - reserved - safeHaven)",
      totalAsset: "totalAsset = available + locked",
    },
    generatedAt: (params.generatedAt ?? new Date()).toISOString(),
    instanceName: params.instanceName,
    meanings: {
      available:
        "Free quote balance before SLOW's virtual reserve subtraction. In live mode this is the exchange free USDT balance, so active-position margin is already excluded.",
      currency: "Unit used by every numeric field in balance.",
      locked:
        "Margin currently committed to active open positions. Do not subtract it from available again.",
      reserved:
        "Virtual portion of available reserved for configured averaging/watch steps on open positions.",
      safeHaven:
        "Virtual protected portion of available kept outside trading spendable capital and intended for capital protection or withdrawal.",
      spendable:
        "Virtual amount available for new entries or unreserved bailout work after reserved and Safe Haven amounts are removed.",
      totalAsset:
        "Available plus locked margin. This is not floating equity and does not add unrealized P&L from open positions.",
    },
    mode: params.mode,
    source:
      params.mode === "live"
        ? "live_exchange_with_persisted_fallback"
        : "sandbox_simulation",
    sourceMeaning:
      params.mode === "live"
        ? "Each call attempts to refresh available from the live exchange; if that read fails, SLOW retains the latest persisted balance while logging the exchange error. Reserved, Safe Haven, and locked values come from SLOW state."
        : "All fields come from the selected sandbox simulation state; no exchange balance is queried.",
  };
}

const runtimeMcpBalanceSummary = { create: createBalanceSummary } as const;

export default runtimeMcpBalanceSummary;
