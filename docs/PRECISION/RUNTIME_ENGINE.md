# Shared Runtime Engine — V1

V1 extracts the common trading path from the existing instances. It does not
introduce a new event framework or rewrite the strategies.

Reference the Multi instance's `src/lib/slowTrading` and `src/lib/trading`.

# A. Goal

Production, sandbox, and backtest call the same runtime functions for decision,
entry, averaging, exit, execution accounting, and state updates.

TC: `BOTH:SHARED_RUNTIME_ENGINE`

# B. Runtime inputs

The runtime receives explicit dependencies:

```ts
interface RuntimeInput {
  mode: "live" | "sandbox" | "backtest";
  now: () => number;
  market: MarketSource;
  execute: ExecutionSource;
  storage: RuntimeStorage;
  strategy: StrategyPlugin;
  config: RuntimeConfig;
}
```

- Live uses current time, live market data, and the exchange library.
- Sandbox uses current time and live market data with simulated execution.
- Backtest uses historical time, historical data, and simulated execution.

# C. Existing production stages

| Stage | Default cadence | Responsibility |
| --- | --- | --- |
| Risk Sentinel | 1 minute | Emergency protection and forced exits |
| Speedup | 1 minute | Monitor promoted open positions |
| Standard Monitoring | 5 minutes | Monitor other open positions |
| Management | 5 minutes | Non-trading management work |
| Capture Entry | 5 minutes | Find entries for symbols without positions |

Keep existing eligibility rules. Backtest calls the same stages at historical
times without real waiting.

TC: `BOTH:RUNTIME_SCHEDULING`

# D. Shared trading flow

For each eligible account and symbol:

1. Load the current config and account state.
2. Load market data visible at the current runtime time.
3. Ask the selected strategy for a decision.
4. Evaluate exit before averaging.
5. Evaluate averaging only if the position remains open.
6. Evaluate entry only when no position blocks it.
7. Send the action to live or simulated execution.
8. Apply the result using shared trading calculations.
9. Save account state and trade history.

Exit must always have priority over averaging.

TC: `BOTH:RUNTIME_EXECUTION_CYCLE`

# E. Strategies and accounts

Multi, Hedge, and Streak implement the same small strategy contract. A strategy
owns its configuration, state, required market data, and decisions. It must not
call the exchange or storage directly.

Share public market data as today. Keep balances, positions, execution, and
storage isolated and process accounts in deterministic order.

TC: `BOTH:PLUGIN_STRATEGY`

# F. Execution evidence and safety

Every trade records expected price, fill price, quantity, fee, request time,
fill time, and status for the Precision Checker.

Backtest and sandbox cannot submit real orders or write live state. Live order
submission keeps the existing idempotency and recovery behavior.

# G. V1 tests

- The three modes call the same trading functions.
- Backtest and production use the same strategy configuration.
- Exit runs before averaging.
- One-minute and five-minute stages run at the expected historical times.
- Accounts do not share private state.
- Backtest and sandbox cannot reach live execution or storage.

# H. Deferred

A generic event envelope, complete adapter hierarchy, generalized workflow
engine, and new persistence architecture are not required for V1.
