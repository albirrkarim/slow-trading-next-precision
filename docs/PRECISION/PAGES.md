# Pages — V1

| Route | Purpose |
| --- | --- |
| `/` | Production and sandbox dashboard |
| `/backtest` | Configure, run, and inspect backtests |
| `/precision-checker` | Compare production and backtest trades |

Pages use grouped server APIs. Trading, execution, storage, and comparison logic
must not be implemented in React components.

# A. Production Dashboard `/`

Use the current `/slow` dashboards as the specification:

```text
/Users/susanto/Documents/OpenSource/trading/slow-trading-next-multi/src/components/LiveDashboard
/Users/susanto/Documents/OpenSource/trading/slow-trading-next-hedge/src/components/LiveDashboard
/Users/susanto/Documents/OpenSource/trading/slow-trading-next-streak/src/components/LiveDashboard
```

Inspect all three before migration. Build one shared dashboard rather than one
copy per strategy.

TC: `PROD:PRODUCTION_DASHBOARD_PAGE`

## A.1 Open positions

The intended strategy-specific page difference is the open-position display:

```text
Multi:  slow-trading-next-multi/src/components/LiveDashboard/Feature/OpenPositions.tsx
Hedge:  slow-trading-next-hedge/src/components/LiveDashboard/Feature/OpenPositions.tsx
Streak: slow-trading-next-streak/src/components/LiveDashboard/Feature/OpenPositions.tsx
```

The shared dashboard selects the correct presenter for canonical position data.
Presenters may group positions differently but cannot calculate or mutate
trading state.

Other differences found during migration should become shared UI unless they
are proven strategy-specific display requirements.

## A.2 Production test case

The shared dashboard provides **Start Production Test Case** and **End
Production Test Case** using `docs/PRECISION/PRECISION_CHECKER.md`.

TC: `PROD:PRODUCTION_TEST_CASE_CAPTURE_CONTROLS`

# B. Backtest Dashboard `/backtest`

Use the existing Multi workflow as reference:

```text
/Users/susanto/Documents/OpenSource/trading/slow-trading-next-multi/src/components/dev/DynamicTrade
```

The page selects strategy, dataset, period, starting state, configuration, and
execution settings; validates them; runs or cancels the backtest; then shows
summary, positions, trades, and charts.

All strategies use this page. Strategy-specific configuration fields come from
the selected strategy. Backtest behavior is defined in
`docs/PRECISION/BACKTEST.md`.

TC: `BTEST:BACKTEST_DASHBOARD_PAGE`

# C. Precision Checker `/precision-checker`

The page selects a production test case and backtest, checks compatibility,
and shows matching, different, missing, and extra trades plus the first
difference. See `docs/PRECISION/PRECISION_CHECKER.md`.

TC: `BTEST:PRECISION_CHECKER_PAGE`

# D. Shared rules

- Always show live, sandbox, or backtest mode.
- Do not display missing or failed data as zero.
- Confirm live trading actions and prevent duplicate submission.
- Do not expose secrets or arbitrary filesystem paths.
- Keep critical controls and status keyboard accessible.
- Load large histories on the server.
