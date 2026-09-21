# Precision Checker — V1

TC: `BOTH:PRECISION_MEASUREMENT`

for the http://localhost:3010/dev/precision-checker

we trying to compare the live execution of the sandbox mode vs when it reply using the backtest method.

i think we need

in the production

http://localhost:3010/

i need to have record of the initial

```
vPointsMap
```

keep the latest 10 vPoints per symbol, plus every vPoint still required by an open position: points at or after the earliest open entry time and every vPoint referenced by an open position's entry or intermediate vPoint refs.

so the tescase will be like

```ts
import type {
  BacktestTestCase,
  PrecisionRuntimeSnapshot,
} from "src/lib/dev/backtestPrecision/api/precision-api-types.ts";

interface PrecisionTestCase extends BacktestTestCase {
  /**
   * Runtime state captured when the recording ends; absent in the pending
   * file. Unlike `initialState`, `vPointsMap` here is a delta: per symbol,
   * the vPoints newly detected during the recording window plus pre-existing
   * points whose content changed while recording. Reconstruct the full map
   * as `initialState.vPointsMap` overlaid with this delta.
   */
  endState?: PrecisionRuntimeSnapshot;
  /**
   * Exact runtime snapshot taken when the recording started: balances per
   * account, still-open positions, and bounded vPoints (latest 10 per symbol
   * plus every point an open position still needs). The enclosing `startTime`
   * is the canonical snapshot and replay time.
   */
  initialState: PrecisionRuntimeSnapshot;
  tradeHistory: Position[];
}
```

# A. Goal

Measure result precision by comparing final production and backtest position
JSON for equivalent runs. No other precision type is measured in V1.

# B. Production capture

The Production Dashboard provides **Start Production Test Case** and **End
Production Test Case**. The Precision Test Cases dashboard section lists
completed captures and allows deleting an individual file after an explicit
confirmation.

TC: `PROD:PRODUCTION_TEST_CASE_CAPTURE_CONTROLS`

# C. Test-case JSON

the time start and end is like `dd-mm-yyyy-hh-mm`

```text
storage/persistent/instances/3010/dev/precision-test-case/live-<start>-<end>.json
storage/persistent/instances/3010/dev/precision-test-case/sandbox-<start>-<end>.json
```

TC: `PROD:PRODUCTION_TEST_CASE`

# E. JSON comparison

Recursively compare the union of leaf paths in both positions:

- Object key order does not matter; array order does.
- Missing, `null`, and present values are different states.
- Strings and booleans require exact equality.
- JSON numbers require exact equality in V1.
- Exclude only `executionMode`; every other persisted position field is compared.

Show both values for every difference. For unequal numbers, show absolute and
percentage difference. Percentage difference is unavailable when production is
zero; if both values are zero, they are equal.

```text
pair precision = equal leaf fields / all leaf fields × 100
overall precision = equal leaves across pairs / all leaves across pairs × 100
```

When no candidate pair exists, overall precision is unavailable.

# F. Page `/dev/precision-checker`


I imagine like top section it list the all the production test cases that has been captured. then select it. 
and theres a button run.

after run we got the backtest result right.

Overview section shows the overall precision score.

Then theres two column of 

[production result] [backtest result]

[table history]     [table history]