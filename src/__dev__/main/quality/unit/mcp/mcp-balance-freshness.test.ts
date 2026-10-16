import { describe, expect, it } from "vitest";

import type {
  RuntimeDashboardAccountSummary,
  RuntimeDashboardState,
} from "@/lib/system/dashboard/types";
import runtimeMcpBalanceSummary from "@/lib/system/mcp/balance-summary";

// PROD:MCP_BALANCE

const balances = {
  availableQuoteAsset: 100,
  lockedQuoteAsset: 0,
  reservedQuoteAsset: 0,
  safeHaven: 0,
  spendableQuoteAsset: 100,
  startingBalanceUSDT: 100,
} as RuntimeDashboardState["balances"];

function account(
  slug: string,
  liveBalance?: RuntimeDashboardAccountSummary["liveBalance"],
): RuntimeDashboardAccountSummary {
  return { activeMode: "live", balances, enabled: true, liveBalance, name: slug, slug };
}

function summarize(accounts: RuntimeDashboardAccountSummary[]) {
  return runtimeMcpBalanceSummary.create({
    activeMode: "live",
    dashboardState: { accountSummaries: accounts, balances } as RuntimeDashboardState,
    instanceName: "PRECISION",
    mode: "live",
  });
}

describe("balance_read live freshness", () => {
  it("reports per account whether the balance was refreshed, when it was last checked and why it failed", () => {
    const checkedAt = Date.UTC(2026, 9, 16, 1, 0, 0);
    const summary = summarize([
      account("main", { checkedAt, refreshed: true }),
      account("second", {
        checkedAt: checkedAt - 3_600_000,
        error: "Invalid API-key, IP, or permissions for action",
        refreshed: false,
      }),
      account("third", { checkedAt: null, refreshed: false }),
    ]);

    expect(summary.accounts.map((item) => item.liveBalance)).toEqual([
      { lastCheckedAt: "2026-10-16T01:00:00.000Z", refreshed: true },
      {
        error: "Invalid API-key, IP, or permissions for action",
        lastCheckedAt: "2026-10-16T00:00:00.000Z",
        refreshed: false,
      },
      { lastCheckedAt: null, refreshed: false },
    ]);
    expect(summary.staleAccounts).toEqual(["second", "third"]);
  });

  it("omits freshness for sandbox accounts", () => {
    const summary = summarize([account("main")]);

    expect(summary.accounts[0].liveBalance).toBeUndefined();
    expect(summary.staleAccounts).toEqual([]);
  });
});
