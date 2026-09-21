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

crop it about 2 month back.

so the tescase will be like

```ts
import type { BacktestTestCase } from "src/lib/dev/backtestPrecision/api/precision-api-types.ts";

interface PrecisionTestCase extends BacktestTestCase {
  tradeHistory: Position[];
  /**
   * Used in precision checker test case
   */
  initialVPointsMap?: Record<string, VolatilityPoint<any>[]>;
}
```

# A. Goal

Measure result precision by comparing final production and backtest position
JSON for equivalent runs. No other precision type is measured in V1.

# B. Production capture

The Production Dashboard provides **Start Production Test Case** and **End
Production Test Case**.

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

Later we make this (not for now)

Select a production test case and backtest result, validate them, and show the
overall score, each pair score and differences, ambiguous keys, and unpaired
positions.
