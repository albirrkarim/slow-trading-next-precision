# Precision Checker — V1

TC: `BOTH:PRECISION_MEASUREMENT`

# A. Goal

Measure result precision by comparing final production and backtest position
JSON for equivalent runs. No other precision type is measured in V1.

# B. Production capture

The Production Dashboard provides **Start Production Test Case** and **End
Production Test Case**. Under the runtime storage lock, Start atomically saves
the strategy, mode, configuration, initial state, the shared volatility
memory per symbol, and start time; End atomically
saves the final form of every position present at Start or created before End,
including positions closed during capture. It does not close positions.

Only one capture may be active per mode. A configuration change or process
restart invalidates it; V1 does not resume or combine captures. End reports the
reason and does not produce a usable test case when capture is invalid.

TC: `PROD:PRODUCTION_TEST_CASE_CAPTURE_CONTROLS`

# C. Test-case JSON

```text
prod-test-case/live-<start>-<end>.json
prod-test-case/sandbox-<start>-<end>.json
```

Use `ProdTestCaseV1` from `DATA_TYPE.md`. Write compact JSON atomically. Capture
times are actual times and cannot recover earlier activity.

TC: `PROD:PRODUCTION_TEST_CASE`

# D. Compatibility and pairing

The checker requires equal strategy, start/end time, effective configuration,
and initial state. Otherwise it refuses scoring and lists mismatched fields.

Pair positions with the canonical key from `DATA_TYPE.md`. Normalize legacy
missing role to `MAIN`. A key must be unique in each result; duplicate keys are
ambiguous, excluded from scoring, and reported. Unpaired positions are reported
and excluded from scoring.

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

TC: `BOTH:PRODUCTION_BACKTEST_POSITION_COMPARISON`

# F. Page `/dev/precision-checker`

Select a production test case and backtest result, validate them, and show the
overall score, each pair score and differences, ambiguous keys, and unpaired
positions.

TC: `BTEST:PRECISION_CHECKER_PAGE`
