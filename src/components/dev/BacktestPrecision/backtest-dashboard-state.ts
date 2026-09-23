import type {
  ConfigDraft,
  DashboardState,
} from "@/components/LiveDashboard/Navbar/navbar-types";
import { VOLATILITY_THRESHOLD } from "@/lib/system/constants";
import { runtimeAccountConfig, runtimeDefaults } from "@/lib/system/runtime";
import { blackSwan } from "@/lib/system/trading/black-swan";

function normalizeStartingBalance(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/** Builds an empty portfolio snapshot for previews in the backtest settings dialog. */
export function buildBacktestDashboardState(
  configDraft: ConfigDraft,
  selectedAccountSlug?: string,
): DashboardState {
  const selectedAccount =
    configDraft.accounts.find(
      (account) => account.slug === selectedAccountSlug,
    ) ??
    configDraft.accounts.find((account) => account.enabled) ??
    configDraft.accounts[0];
  const enabledAccounts = configDraft.accounts.filter(
    (account) => account.enabled,
  );
  const combinedStartingBalance = enabledAccounts.reduce(
    (total, account) =>
      total + normalizeStartingBalance(account.sandbox.initialBalanceUSDT),
    0,
  );

  // BTEST:BACKTEST_SETTINGS_LIVE_PREVIEW
  return {
    accountFilter: selectedAccount?.slug ?? null,
    accounts: structuredClone(configDraft.accounts),
    accountSummaries: configDraft.accounts.map((account) => {
      const startingBalanceUSDT = normalizeStartingBalance(
        account.sandbox.initialBalanceUSDT,
      );
      return {
        activeMode: "sandbox",
        balances: {
          availableQuoteAsset: startingBalanceUSDT,
          lockedQuoteAsset: 0,
          reservedQuoteAsset: 0,
          safeHaven: 0,
          spendableQuoteAsset: startingBalanceUSDT,
          startingBalanceUSDT,
        },
        enabled: account.enabled,
        name: account.name,
        slug: account.slug,
      };
    }),
    activeMode: "sandbox",
    balances: {
      availableQuoteAsset: combinedStartingBalance,
      lockedQuoteAsset: 0,
      reservedQuoteAsset: 0,
      safeHaven: 0,
      spendableQuoteAsset: combinedStartingBalance,
      startingBalanceUSDT: combinedStartingBalance,
    },
    blackSwan: blackSwan.state.create(),
    config: selectedAccount
      ? runtimeAccountConfig.trading.toEffective(
          {
            ...runtimeDefaults.management.create(),
            ...runtimeDefaults.trading.create(),
            ...configDraft.management,
          },
          selectedAccount,
        )
      : {
          ...runtimeDefaults.management.create(),
          ...runtimeDefaults.trading.create(),
          ...configDraft.management,
        },
    globalConfig: { volatilityThresholdPct: VOLATILITY_THRESHOLD },
    history: [],
    openPositions: [],
    runtime: { ...configDraft.runtime },
    stats: {
      closedTrades: 0,
      openPositions: 0,
      stageRuns: {},
    },
  };
}
