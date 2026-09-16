# Precision Trading System

This document is written by HUMAN, This act like the backbone docs of the system

See `docs/SPECS/_SPECS.md` for the meaning of `TC`.

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

The primary purpose of the Precision Trading System is to make backtest
behavior and results reproduce production behavior and results as closely to
1:1 as the available historical market data permits. Given the same period,
strategy, configuration, and starting state, backtest and production must use
the same runtime and strategy path. Their differences must be limited to
environment adapters.

- **Scalable:** The runtime must use memory efficiently and coordinate external
  API calls carefully as the number of accounts, symbols, and strategies grows.
- **Precise:** Backtest and production must produce reproducible and closely
  comparable results. The exact precision guarantees and measurements are
  defined in Section D.
- **Flexible:** The system must support the existing strategies from the 3 instance and allow future
  strategies to be added without duplicating or rewriting the runtime engine.

The core of this foundation is one shared runtime engine for both production and
backtest. They must execute the same trading logic through the same runtime and
strategy implementations. Differences between environments must be limited to
replaceable adapters, such as market data, time, exchange execution, storage,
and monitoring.

See `docs/PRECISION/RUNTIME_ENGINE.md` for details.

# C. Non-Goals

- This project does not introduce or redesign trading strategies.

# D. Meaning of Precision

V1 measures **result precision only**: how closely the final production position
JSON matches the final backtest position JSON for the same trade.

A production position and backtest position become a comparison candidate when
they have the same account, symbol, direction, entry `vPoint.id`, and normalized
role. A missing legacy role is normalized to `MAIN`.

Both positions must come from runs with the same period, strategy,
configuration, and starting state. Open positions must remain open at the end
of the backtest so both JSON results describe the same moment.

The Precision Checker compares the final position objects field by field after
excluding only `executionMode`. Object key order does not matter; array order
does.

For each candidate pair:

- Equal comparable fields count as precise.
- Different fields show both values.
- Numeric differences also show their absolute and percentage gaps.
- A position's result precision is the percentage of comparable leaf fields
  that are equal.
- Overall result precision uses all comparable leaves across candidate pairs.

Production-only and backtest-only positions are reported separately and are not
silently treated as matches. Input, decision, order-intent, and execution
precision are not part of V1.

See `docs/PRECISION/PRECISION_CHECKER.md` for the comparison workflow.

# E. System Architecture

The architecture must be flexible enough to accommodate:

- The three existing strategies, selected through explicit configuration
- A clean folder structure, defined in `docs/PRECISION/FOLDER.md`
- One shared runtime engine, defined in `docs/PRECISION/RUNTIME_ENGINE.md`
- Data types that support the system's goals

# F. Migration Plan

## 1. Folder structure

The folder structures of the three existing implementations are inconsistent
and difficult to maintain.

Define the new folder structure in `docs/PRECISION/FOLDER.md`.

## 2. Plan position data types

Define the detailed data types in `docs/PRECISION/DATA_TYPE.md`.

- Define a shared position structure that supports all three strategies while
  allowing each strategy to store its own strategy-specific state.
- Preserve the existing position fields needed by each strategy.
- Ensure every position exposes a stable entry `vPoint.id` so production and
  backtest results can be paired.
- Define which environment-only fields are excluded from result comparison.

## 3. Planning the runtime engine

Design the runtime engine in `docs/PRECISION/RUNTIME_ENGINE.md` alongside the
backtest requirements in `docs/PRECISION/BACKTEST.md`.

# G. Definition of Done

The Precision Trading System is complete when:

- The Multi, Hedge, and Streak strategies use the shared runtime engine.
- Backtest, sandbox, and live modes execute through the same core runtime path.
- A recorded production test case can be compared with a backtest for the same
  period, strategy, configuration, and starting state.
- The Precision Checker pairs positions by their entry `vPoint.id` and reports
  field-level differences in their final position JSON.
- The Precision Checker calculates result precision for every candidate pair.
- API calls, execution duration, errors, retries, and rate-limit usage are measurable.

Important details:

Backtest

- it should simulate when the vpoints are forming using klines data
- the averaging execution is not exactly on the vpoint time because real condition of production vpoint have retrace about 1% first, so looking time and price on the klines

# H. Resolving

The other document except `_PRECISION.md` of this project is just raw and unchecked by human.

so its not a solid instruction.

For example the data type / dataset form, it might be adjusted later depend on the requirement of this backbone document.

# I. References

## Existing strategy implementations

```
/Users/susanto/Documents/OpenSource/trading/slow-trading-next-streak
/Users/susanto/Documents/OpenSource/trading/slow-trading-next-multi
/Users/susanto/Documents/OpenSource/trading/slow-trading-next-hedge
```
