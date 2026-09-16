# Folder Structure — V1

Use Multi as the application base, copy proven libraries, and change only what
is needed to share production and backtest behavior.

# A. Target structure

```text
src/
  app/
    (dashboard)/page.tsx
    dev/backtest/page.tsx
    dev/precision-checker/page.tsx
  components/
    LiveDashboard/
    BacktestDashboard/
    PrecisionChecker/
  lib/
    exchange/
    trading/
    runtime/
      cycle/
      storage/
    strategies/
      multi/
      hedge/
      streak/
      index.ts
    backtest/
      dataset/
      runner/
      index.ts
    precision/
      capture/
      compare/
      index.ts
    env/
    notification/
```

Keep the current test and development structure during V1. Reorganizing every
test, script, and component is not required to achieve precision.

# B. Ownership

- `exchange`: copy the existing exchange library and keep its grouped API.
- `trading`: shared position, entry, averaging, exit, fee, and PnL calculations.
- `runtime`: shared production/backtest orchestration, stages, state, and storage.
- `strategies`: only Multi, Hedge, and Streak decision differences.
- `backtest`: historical dataset loading and simulated execution; no copied trading logic.
- `precision`: production test-case capture and final-position comparison.
- `components`: shared pages; only open-position presentation varies by strategy.

TC: `BOTH:MODULE_BOUNDARIES`

# C. Exchange library

Copy Multi's existing `src/lib/exchange` directly to this project's
`src/lib/exchange`.

Do not split it into new infrastructure and adapter hierarchies in V1. Refactor
only where the shared runtime needs a clear market-data or order-execution function.

# D. Strategy sources

```text
Multi:  /Users/susanto/Documents/OpenSource/trading/slow-trading-next-multi
Hedge:  /Users/susanto/Documents/OpenSource/trading/slow-trading-next-hedge
Streak: /Users/susanto/Documents/OpenSource/trading/slow-trading-next-streak
```

Each strategy exports one plugin through `src/lib/strategies/index.ts`. Do not
copy the runtime, exchange library, backtest, or full dashboard into a strategy.

TC: `BOTH:PLUGIN_STRATEGY`

# E. Migration map

| Existing source | V1 target |
| --- | --- |
| Multi application and shared UI | Copy as the project base |
| `src/lib/exchange` | `src/lib/exchange` |
| `src/lib/slowTrading` | `src/lib/runtime` |
| Shared `src/lib/trading` code | `src/lib/trading` |
| Strategy decisions | `src/lib/strategies/<strategy>` |
| `src/lib/dynamic/backtest-volatility` | `src/lib/backtest` |
| Production test-case and comparison | `src/lib/precision` |

Classify mixed legacy files before moving them. Shared behavior goes to
`trading` or `runtime`; only genuine strategy differences go to `strategies`.

Do not add `domain`, `ports`, `infrastructure`, `persistence`, or `composition`
layers in V1 unless proven necessary.
