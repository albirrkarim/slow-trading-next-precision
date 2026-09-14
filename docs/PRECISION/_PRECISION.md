# Precision Trading System

see what `TC` mean in `docs/SPECS/_SPECS.md`

# A. Problem

The current implementation in
`/Users/susanto/Documents/OpenSource/trading/slow-trading-next-multi` does not
produce sufficiently consistent results between backtest and production.

The two environments do not follow the same runtime path. The backtest consumes
historical volatility-rail data, while production consumes live market data,
runs on separate schedules, and processes positions through Speedup and Standard
Monitoring stages. Production also uses a combination of 1-minute and 5-minute
klines. These differences in data, timing, and execution flow can cause the same
strategy and configuration to produce different decisions and trading results.

The current architecture also couples strategy, runtime, market data, and
execution behavior too closely. This makes the system difficult to reuse across
strategies, test consistently, monitor, and compare precisely between backtest
and production.

# B. Goals

Build a trading-system foundation that is scalable, precise, and flexible.

- **Scalable:** The runtime must use memory efficiently and coordinate external
  API calls carefully as the number of accounts, symbols, and strategies grows.
- **Precise:** Backtest and production must produce reproducible and closely
  comparable results. The exact precision guarantees and measurements are
  defined in Section D.
- **Flexible:** The system must support the existing strategies and allow future
  strategies to be added without duplicating or rewriting the runtime engine.

The core of this foundation is one shared runtime engine for both production and
backtest. They must execute the same trading logic through the same runtime and
strategy implementations. Differences between environments must be limited to
replaceable adapters, such as market data, time, exchange execution, storage,
and monitoring.

See `docs/PRECISION/RUNTIME_ENGINE.md` for details.

# C. Non - Goals

- We are not reinventing new trading strategies

# D. Meaning of Precision

Precision measures how closely a backtest reproduces the recorded production
result for the same period, strategy, configuration, and starting state.

The backtest uses simulated exchange execution, so its execution and financial
results are not expected to be identical to production. Every difference must
be measurable and explainable.

Precision must be measured separately for each aspect:

- **Input precision:** Whether both runs received equivalent normalized market
  events in the same order and at the same logical time.
- **Decision precision:** Whether the strategy produced the same decisions.
- **Order-intent precision:** Whether both runs requested the same action, side,
  order type, quantity, and intended price.
- **Execution precision:** Differences in fill price, filled quantity, fees,
  slippage, latency, partial fills, rejections, and cancellations.
- **Result precision:** Differences in position state, balance, and PnL.

Decision and order-intent precision must match exactly when the inputs are
identical. Execution and result precision may differ because live trading is
affected by network latency, liquidity, slippage, exchange behavior, and market
movement.

The Precision Checker must report a separate score for each aspect, identify the
first event where the runs diverged, and provide an overall precision score. The
overall score must not hide an important decision or execution difference.

See `docs/PRECISION/PRECISION_CHECKER.md` for measurement formulas, tolerances,
recording requirements, and comparison reports.

# E. System Architecture

I want it can flexible can accomodate:

- my 3 instance strategies. with some switch
- have good folder structure `docs/PRECISION/FOLDER.md`
- one shared runtime engine `docs/PRECISION/RUNTIME_ENGINE.md`
- data types that can support our goals

# F. Migration Plan

## 1. Folder structure

The current 3 instance folder structure is messy.

Plan good folder structure in `docs/PRECISION/FOLDER.md`

## 2. Plan position data types

Write the detail in `docs/PRECISION/DATA_TYPE.md`

- Define a shared position structure that supports all three strategies while
  allowing each strategy to store its own strategy-specific state.
- Every entry, averaging, partial fill, and exit execution must preserve enough
  pricing and timing evidence for `docs/PRECISION/PRECISION_CHECKER.md`.
- Execution evidence must include the expected price, actual average fill price,
  quantity, fees, request time, acknowledgement time, and fill time. This allows
  the system to measure slippage and exchange execution latency.
- A position may contain multiple execution records; slippage must not be stored
  as only one value for the whole position.
- Keep complete raw exchange requests and responses in a separate execution
  audit or production test-case log instead of storing them directly in the
  position JSON.

## 3. Planing the runtime engine

`docs/PRECISION/RUNTIME_ENGINE.md` considering `docs/PRECISION/BACKTEST.md`

# G. Definition of Done

The Precision Trading System is complete when:

- The Multi, Hedge, and Streak strategies use the shared runtime engine.
- Backtest, sandbox, and live modes execute through the same core runtime path.
- A recorded production test case can be compared with a backtest for the same
  period, strategy, configuration, and starting state.
- Identical inputs produce identical strategy decisions and order intentions.
- The Precision Checker can score "how precise the backtest and the actual record from production"
- API calls, execution duration, errors, retries, and rate-limit usage are measurable.

# H. References

## 3 instances

```
/Users/susanto/Documents/OpenSource/trading/slow-trading-next-streak
/Users/susanto/Documents/OpenSource/trading/slow-trading-next-multi
/Users/susanto/Documents/OpenSource/trading/slow-trading-next-hedge
```
