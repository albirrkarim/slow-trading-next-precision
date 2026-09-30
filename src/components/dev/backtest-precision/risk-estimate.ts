import type { ConfigDraft } from "@/components/settings/settings-types";
import { buildTradingLivePreview } from "@/lib/system/trading/live-preview";

import { buildBacktestDashboardState } from "./backtest-dashboard-state";

/** Per-account first-stop-loss estimate for one backtest settings draft. */
export interface BacktestAccountRiskEstimate {
    accountSlug: string;
    accountName: string;
    /** Reserve multiplier applied to each averaging margin step. */
    averagingMultiplier: number;
    /** Configured averaging stages beyond the initial entry. */
    averagingStages: number;
    /** Sandbox starting balance used as the spendable basis. */
    balanceUsdt: number;
    /** Absolute vPoint level the first entry can use. */
    entryLevelMin: number;
    entryMarginUsdt: number;
    leverage: number;
    /** Largest first-stop loss across the entry + averaging stages. */
    lossMaxUsdt: number;
    /** Smallest first-stop loss across the entry + averaging stages. */
    lossMinUsdt: number;
}

/** Portfolio-wide risk summary: the min–max loss range across accounts. */
export interface BacktestRiskEstimate {
    accounts: BacktestAccountRiskEstimate[];
    lossMaxUsdt: number | null;
    lossMinUsdt: number | null;
}

/**
 * Estimates configured first-stop-loss ranges for every enabled account using
 * the same live-preview math the Trading settings dialog renders. Backtests
 * always run on the sandbox basis, so each account's configured starting
 * balance stands in for spendable balance — no credentials or live balance
 * data are involved.
 */
function estimate(settings: ConfigDraft): BacktestRiskEstimate {
    const accounts = settings.accounts
        .filter((account) => account.enabled)
        .flatMap<BacktestAccountRiskEstimate>((account) => {
            const balanceUsdt = Math.max(
                0,
                Number(account.sandbox?.initialBalanceUSDT) || 0,
            );
            if (balanceUsdt <= 0) return [];

            const dashboardState = buildBacktestDashboardState(
                settings,
                account.slug,
            );
            const preview = buildTradingLivePreview({
                config: dashboardState.config,
                dashboardState,
                spendableAssumptionUsdt: balanceUsdt,
            });
            if (preview.entryMarginUsdt <= 0) return [];

            const losses = preview.exitStages
                .map((stage) => stage.firstStopLoss?.estimatedLossUsdt)
                .filter(
                    (loss): loss is number =>
                        typeof loss === "number" && Number.isFinite(loss),
                );
            if (!losses.length) return [];

            const effective = dashboardState.config;
            return [
                {
                    accountName: account.name?.trim() || account.slug,
                    accountSlug: account.slug,
                    averagingMultiplier: effective.watchReservePctAlloc ?? 2,
                    averagingStages: Math.max(0, preview.exitStages.length - 1),
                    balanceUsdt,
                    entryLevelMin: Math.max(
                        0,
                        Math.floor(
                            effective.minEntryAbsLevel ??
                                effective.maxEntryAbsLevel ??
                                2,
                        ),
                    ),
                    entryMarginUsdt: preview.entryMarginUsdt,
                    leverage: preview.leverage,
                    lossMaxUsdt: Math.max(...losses),
                    lossMinUsdt: Math.min(...losses),
                },
            ];
        });

    return {
        accounts,
        lossMaxUsdt: accounts.length
            ? Math.max(...accounts.map((account) => account.lossMaxUsdt))
            : null,
        lossMinUsdt: accounts.length
            ? Math.min(...accounts.map((account) => account.lossMinUsdt))
            : null,
    };
}

const backtestRisk = { estimate } as const;

export default backtestRisk;
export { backtestRisk };
