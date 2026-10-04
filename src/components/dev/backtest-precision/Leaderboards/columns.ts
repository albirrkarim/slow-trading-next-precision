export interface HeaderGroup {
    id: string;
    label: string;
    align?: "left" | "right" | "center";
    children?: { id: string; label: string; tooltip?: string }[];
    tooltip?: string;
}

export const HEADER_GROUPS: HeaderGroup[] = [
    {
        id: "label",
        label: "Label",
        tooltip: "Name of this saved run.\nFalls back to the backtest name or date range when no label was set.\nThe entry id is a content hash — re-saving the same config + range overwrites it.\nSource: entry.label → backtestConfig.name → range → id (storage/leaderboards/[hash].json).",
    },
    {
        id: "t",
        label: "Saved At",
        tooltip: "When the run was persisted via the \"Save run to leaderboards\" button.\nShown in WIB (Asia/Jakarta), DD MMM [YYYY] HH:mm 24h — the year appears only when it differs from the current one.\nSource: entry.t on the saved file (storage/leaderboards/[hash].json).",
    },
    {
        id: "backtestConfig.range",
        label: "Range",
        tooltip: "The backtest menu's range selection used for this run (e.g. 1month, 1year).\nRuns saved with explicit bounds (\"custom\") also show the resolved start → end dates under the label, in WIB.\nLonger is better — shaded by the resolved span in days.\nSource: backtestConfig.range + backtestConfig.startTime/endTime on the saved entry.",
    },
    {
        id: "backtestConfig.settings.management.strategy",
        label: "Strategy",
        tooltip: "The management.strategy selection active for this run (Both, Streak, or a custom slug).\nSaved entries without a settings block ran the built-in default pipeline.\nSource: backtestConfig.settings.management.strategy on the saved entry.",
    },
    {
        id: "volatilityDetection",
        label: "V Thres",
        align: "center",
        tooltip: "Volatility detector params this run was saved with.\nmove — percent move from the last pivot that starts a new UP/DOWN volatility sequence (management.volatilityThreshold).\nretrace — percent pullback from a local extreme that confirms a pivot once a sequence is active (management.volatilityRetracePct).\nenv = the field was unset, so the run used the server env default (VOLATILITY_THRESHOLD / VOLATILITY_RETRACE_PERCENT). Entries saved before these fields existed also show env.\nSource: backtestConfig.settings.management on the saved entry.",
        children: [
            {
                id: "backtestConfig.settings.management.volatilityThreshold",
                label: "move",
                tooltip: "management.volatilityThreshold — percent move activating a volatility sequence.\nenv = server env default was used.",
            },
            {
                id: "backtestConfig.settings.management.volatilityRetracePct",
                label: "retrace",
                tooltip: "management.volatilityRetracePct — percent retrace confirming a pivot.\nenv = server env default was used.",
            },
        ],
    },
    {
        id: "minEquity",
        label: "Min Equity",
        tooltip: "Minimum equity the saved config was sized to run — the sum of every enabled account's starting balance.\nShown as [name $x] + [name $y] = $total.\nSorting compares the $total.\nSource: backtestConfig.settings.accounts[].enabled + sandbox.initialBalanceUSDT.",
    },
    {
        id: "leaderboard.gainPct",
        label: "Gain",
        align: "right",
        tooltip: "Total realized return over the whole run.\n(final total − starting balance) / starting balance × 100%.\nStarting balance = sum of every account's initial balance.\nFinal total = last combined balance snapshot — open-position PnL is excluded.\nHigher is better.\nSource: backtest result → balanceSnapshots (each account's startingBalance + last timeline total), computed at save time.",
    },
    {
        id: "leaderboard.winRate",
        label: "Win Rate",
        align: "right",
        tooltip: "Closed positions that finished with net USDT profit > 0, as a percentage of all closed positions.\nStill-open positions are not counted.\nSource: backtest result → positions[].closed + pnl.netUsdt.",
    },
    {
        id: "leaderboard.positionsClosed",
        label: "Trades",
        align: "right",
        tooltip: "Number of closed positions over the backtest range, summed across all accounts.\nMore trades means more samples — but also more fees, so read it together with Gain and Monthly Gain.\nSource: backtest result → positions[] with a closed event.",
    },
    {
        id: "leaderboard.tradesPerDay",
        label: "Trades/Day",
        align: "right",
        tooltip: "Closed positions per day over the run's trading window — realized income cadence.\nThe ~2-month volatility-point warm-up is excluded: the divisor spans first→last balance snapshot, and the config-range fallback subtracts the same warm-up.\nHigher = more frequent income. Read it beside Win Rate and Sharpe.\nSource: leaderboard.tradesPerDay → positionsClosed ÷ (timeline span).",
    },
    {
        id: "leaderboard.sharpeRatio",
        label: "Sharpe",
        align: "right",
        tooltip: "Sharpe ratio of month-over-month total-balance returns (UTC months).\nmean(monthly returns) / stddev(monthly returns) — not annualized.\n0 when fewer than 2 monthly returns exist in the range.\nHigher = smoother compounding.\nSource: backtest result → balanceSnapshots month-end combined totals.",
    },
    {
        id: "leaderboard.maxPortfolioDrawdown",
        label: "Portfolio DD",
        align: "center",
        tooltip: "Worst unrealized USDT dip each position ever reached, as a share of the portfolio.\n−pnl.maxDownUsdt / mean total balance, per position.\nUnlike Floating DD 'usd', each dip is normalized by portfolio size.\nLower is better — negative means a position never went underwater.\nSource: positions[].pnl.maxDownUsdt ÷ mean balanceSnapshots.total.",
        children: [
            {
                id: "leaderboard.maxPortfolioDrawdown.avg",
                label: "avg",
                tooltip: "Mean per-position worst dip as a share of the portfolio — the typical worst-case drag one trade put on total balance.\nSource: positions[].pnl.maxDownUsdt ÷ mean balanceSnapshots.total.",
            },
            {
                id: "leaderboard.maxPortfolioDrawdown.max",
                label: "max",
                tooltip: "Worst single trade — the deepest one position ever dragged the portfolio.\nSource: positions[].pnl.maxDownUsdt ÷ mean balanceSnapshots.total.",
            },
        ],
    },
    {
        id: "leaderboard.maxFloatingDrawdown",
        label: "Floating DD",
        align: "center",
        tooltip: "Deepest dip each position ever saw, shown in two units.\npct — −pnl.maxDownPct / 100: dip vs the position's own deployed notional.\nusd — −pnl.maxDownUsdt: raw USDT loss at its worst.\navg = mean across positions · max = worst single trade. Lower is better.\nSource: positions[].pnl.maxDownPct / maxDownUsdt — exact running extrema kept every monitoring pass (more accurate than the bucketed pnl.history).",
        children: [
            {
                id: "leaderboard.maxFloatingDrawdown.avg",
                label: "avg pct",
                tooltip: "Mean deepest dip across positions, as a share of each position's own notional — the typical worst-case per trade.\nSource: −positions[].pnl.maxDownPct / 100.",
            },
            {
                id: "leaderboard.maxFloatingDrawdown.max",
                label: "max pct",
                tooltip: "Worst single position — the deepest any trade dipped vs its own notional.\nSource: −positions[].pnl.maxDownPct / 100.",
            },
            {
                id: "leaderboard.maxFloatingDrawdownUsdt.avg",
                label: "avg usd",
                tooltip: "Mean worst USDT dip across positions — the typical worst-case loss per trade, un-normalized.\nSource: −positions[].pnl.maxDownUsdt.",
            },
            {
                id: "leaderboard.maxFloatingDrawdownUsdt.max",
                label: "max usd",
                tooltip: "Worst single trade — the most one position ever lost while open.\nSource: −positions[].pnl.maxDownUsdt.",
            },
        ],
    },
    {
        id: "leaderboard.bearMarketProofRatio",
        label: "Bear Proof",
        align: "right",
        tooltip: "Resilience inside detected bear windows.\nA bear window is a ≥20% peak→trough drawdown on a symbol's volatility-point price series.\nScore = 100 − mean portfolio floating drag inside those windows.\n100 = untouched by bear phases · 0 = no bear window found in the range.\nSource: vPointsMap price series per symbol (window detection) + balance/position timeline (drag inside windows).",
    },
    {
        id: "leaderboard.monthlyGain",
        label: "Monthly Gain",
        align: "center",
        tooltip: "Realized net profit per UTC month / month-start total balance × 100%.\nMonths covered by the balance timeline with no closed trades count as 0%.\nSource: positions[].closed.t + pnl.netUsdt grouped by UTC month, over month-start totals from balanceSnapshots.",
        children: [
            {
                id: "leaderboard.monthlyGain.min",
                label: "min",
                tooltip: "Worst calendar month — the floor of realized monthly performance.\nSource: same monthly series as Monthly Gain.",
            },
            {
                id: "leaderboard.monthlyGain.avg",
                label: "avg",
                tooltip: "Mean realized gain across all covered months — includes 0% months with no closed trades.\nSource: same monthly series as Monthly Gain.",
            },
            {
                id: "leaderboard.monthlyGain.max",
                label: "max",
                tooltip: "Best calendar month of the run.\nSource: same monthly series as Monthly Gain.",
            },
        ],
    },
    {
        id: "leaderboard.avgMonthlyProfitPct",
        label: "Avg Monthly",
        align: "right",
        tooltip: "Average realized monthly profit as a share of the STARTING balance.\nmean(monthly net USDT) / starting balance × 100%.\nA flat-rate view — unlike Monthly Gain it does not compound off the growing balance.\nSource: same monthly pnl.netUsdt series ÷ combined startingBalance from balanceSnapshots.",
    },
    {
        id: "leaderboard.balanceTradesScore",
        label: "Trades Bal",
        align: "right",
        tooltip: "How evenly closed trades are spread across symbols.\nexp(−CV) of per-symbol closed-trade counts.\n100% = perfectly even · lower = concentrated in a few coins.\nDefaults to 100% when no trades closed.\nSource: positions[] grouped by symbol (closed trades only).",
    },
    {
        id: "leaderboard.capitalEfficiency",
        label: "Capital Eff",
        align: "center",
        tooltip: "How hard the balance worked during the run.\nHR — held-ratio score: 1 − time-weighted locked/total. Higher = less capital stuck in open positions.\nTR — turnover score: daily locked-capital turnover normalized to average total balance, clamped to 100%. Higher = capital recycles faster.\nFinal — (HR + TR) / 2.\nSource: balanceSnapshots locked + total fields, time-weighted across the run.",
        children: [
            {
                id: "leaderboard.capitalEfficiency.hrScore",
                label: "HR",
                tooltip: "Held-ratio score: 1 − time-weighted (locked / total).\nHigher = less capital parked in open positions.\nSource: balanceSnapshots locked + total timeline.",
            },
            {
                id: "leaderboard.capitalEfficiency.trScore",
                label: "TR",
                tooltip: "Turnover score: daily locked-capital turnover ÷ average total balance, clamped to 100%.\nHigher = capital recycles faster.\nSource: balanceSnapshots — sum of |Δlocked| per day ÷ avg total.",
            },
            {
                id: "leaderboard.capitalEfficiency.score",
                label: "Final",
                tooltip: "Combined efficiency score: (HR + TR) / 2.\nHigher = balance stayed both free and active.\nSource: the HR and TR scores above.",
            },
        ],
    },
    {
        id: "leaderboard.emptyBalance",
        label: "Empty Balance",
        align: "center",
        tooltip: "How long the combined spendable balance stayed ≤ $2 — below the trading minimum — per consecutive dry spell.\nAll zeros = never ran dry: entries were never starved for quote.\nSource: balanceSnapshots spendable field vs the $2 trading minimum.",
        children: [
            {
                id: "leaderboard.emptyBalance.min",
                label: "min",
                tooltip: "Shortest dry spell — the smallest stretch without spendable balance.\nSource: same spendable timeline as Empty Balance.",
            },
            {
                id: "leaderboard.emptyBalance.avg",
                label: "avg",
                tooltip: "Mean dry-spell length.\nSource: same spendable timeline as Empty Balance.",
            },
            {
                id: "leaderboard.emptyBalance.max",
                label: "max",
                tooltip: "Longest dry spell — the worst stretch without spendable balance.\nSource: same spendable timeline as Empty Balance.",
            },
        ],
    },
];

/** Total leaf columns plus the leading Favorite and trailing Actions columns. */
export function tableColspan(groups: HeaderGroup[]): number {
    return (
        groups.reduce(
            (sum, group) => sum + (group.children?.length ?? 1),
            0,
        ) + 2
    );
}
