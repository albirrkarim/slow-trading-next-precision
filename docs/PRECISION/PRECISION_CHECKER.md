# Precision Checker — V1

TC: `BOTH:PRECISION_MEASUREMENT`

# A. Goal

Answer: **How closely does the final production position match backtest?**

V1 measures result precision only by comparing final position JSON from the
same period, strategy, configuration, and starting state.

# B. Create a production test case

The Production Dashboard provides **Start Production Test Case** and **End
Production Test Case**. Start saves the configuration and initial state. End
saves the final form of positions created, changed, or closed during capture.
The controls must not change trading or close positions.

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
  endPositions: Position[];
}
```

TC: `PROD:PRODUCTION_TEST_CASE`

# D. Candidate pairing

Pair a production position with a backtest position when these values match:

- Account
- Symbol and direction
- Entry `vPoint.id`
- Role or pair identity when required by Hedge or Streak

Each position may belong to only one pair. Report unpaired positions separately.

# E. Result comparison

Compare each pair's final position objects field by field. Ignore object key
order but preserve array order. Exclude only fields explicitly marked as
environment-only, including `executionMode`.

```text
result precision = equal comparable leaf fields / all comparable leaf fields × 100
```

Comparable fields are the union of leaf paths in both objects; a missing field
is different. Show every difference with both values. For numbers, also show
the absolute and percentage difference. Do not score unpaired positions.

TC: `BOTH:PRODUCTION_BACKTEST_POSITION_COMPARISON`

# F. Page `/precision-checker`

The page selects a production test case and compatible backtest, validates their
period, configuration, and initial state, then shows candidate pairs, each result
precision score, field differences, and unpaired positions.

TC: `BTEST:PRECISION_CHECKER_PAGE`

# G. Not in V1

Input, decision, order-intent, and execution precision are not measured.
