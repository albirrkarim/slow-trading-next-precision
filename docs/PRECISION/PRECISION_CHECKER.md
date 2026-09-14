# Precision Checker — V1

TC: `BOTH:PRECISION_MEASUREMENT`

# A. Goal

Answer: **How closely does production execution match the backtest?**

V1 compares production trade history with a backtest for the same period,
configuration, and starting state.

# B. Create a production test case

The Production Dashboard provides:

- **Start Production Test Case**
- **End Production Test Case**

Start records the current configuration and state. Every entry, averaging, and
exit is recorded until End is pressed. These controls must not change trading
or close positions.

```text
Start: 15 Sep 2026
End:   20 Sep 2026
```

The times are actual capture times; capture cannot recover earlier activity.

TC: `PROD:PRODUCTION_TEST_CASE_CAPTURE_CONTROLS`

# C. Test-case JSON

```text
prod-test-case/live-<start>-<end>.json
prod-test-case/sandbox-<start>-<end>.json
```

```ts
interface ProdTestCase {
  mode: "live" | "sandbox";
  startTime: number;
  endTime: number;
  config: { runtime: RuntimeConfig; trading: TradingConfig };
  initialState: RuntimeState;
  tradeHistory: TradeHistory[];
}
```

`initialState` contains starting balances, positions, orders, and strategy
state. Each trade records entry/average/exit kind, side, expected and fill
price, quantity, fee, request and fill time, status, and closed PnL.

Raw exchange requests and responses stay outside this JSON.

TC: `PROD:PRODUCTION_TEST_CASE`

# D. Compare with backtest

Run or select a backtest with the same period, configuration, initial state, and
strategy. Its historical dataset must cover the period, and open positions must
remain open at the comparison end.

For each production and backtest execution, compare:

- Entry, averaging, or exit existence
- Side, order type, price, quantity, and fee
- Request and fill time
- Status, resulting position, and PnL

Report matching, different, production-only, and backtest-only trades; show the
first different trade and the average/largest price, fee, timing, and PnL gaps.
Always display actual values so an overall result cannot hide a missing trade.

TC: `BOTH:PRODUCTION_BACKTEST_TRADE_COMPARISON`

# E. Page `/precision-checker`

The page selects a production test case and compatible backtest, validates
their time/configuration/initial state, runs the comparison, and displays the
summary plus individual trade differences.

TC: `BTEST:PRECISION_CHECKER_PAGE`

# F. Deferred

V1 measures execution and result precision. Input, decision, and order-intent
precision require additional evidence and are deferred without changing this
start, end, backtest, and comparison workflow.
