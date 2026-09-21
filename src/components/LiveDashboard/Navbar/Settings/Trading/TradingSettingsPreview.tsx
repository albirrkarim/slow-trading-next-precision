"use client";

import TradingLivePreview from "../../../Feature/TradingLivePreview";
import type { ConfigDraft, DashboardState } from "../settings-types";

/** Builds the portfolio snapshot owned by the account being edited. */
function selectAccountPreviewState(
  dashboardState: DashboardState,
  accountSlug: string,
): DashboardState {
  const account = dashboardState.accountSummaries?.find(
    (candidate) => candidate.slug === accountSlug,
  );
  if (!account) {
    return dashboardState;
  }

  const history = dashboardState.history.filter(
    (position) => position.account === accountSlug,
  );
  const openPositions = dashboardState.openPositions.filter(
    (position) => position.account === accountSlug,
  );

  // PROD:TRADING_ACCOUNT_SCOPED_LIVE_PREVIEW
  return {
    ...dashboardState,
    accountFilter: account.slug,
    accountSummaries: [account],
    activeMode: account.activeMode,
    balances: account.balances,
    history,
    openPositions,
    runtime: dashboardState.runtime,
    stats: {
      ...dashboardState.stats,
      closedTrades: history.length,
      openPositions: openPositions.length,
    },
  };
}

export default function TradingSettingsPreview({
  configDraft,
  dashboardState,
  selectedAccountSlug,
}: {
  configDraft: ConfigDraft;
  dashboardState: DashboardState;
  selectedAccountSlug?: string;
}) {
  const accountSlug =
    selectedAccountSlug ?? configDraft.accounts[0]?.slug;
  const selectedAccount = configDraft.accounts.find(
    (account) => account.slug === accountSlug,
  );
  if (!selectedAccount) return null;

  const accountDashboardState = selectAccountPreviewState(
    dashboardState,
    accountSlug,
  );

  return (
    <TradingLivePreview
      allowSpendableAssumption
      config={{ ...configDraft.management, ...selectedAccount.trading }}
      dashboardState={accountDashboardState}
      key={accountSlug}
      sticky
    />
  );
}
