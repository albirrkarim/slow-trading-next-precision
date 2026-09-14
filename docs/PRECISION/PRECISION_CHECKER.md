# Precision Checker

This document defines how the system captures a production test case, compares
it with a backtest, locates the first divergence, and reports precision.

The meaning of precision is defined in `docs/PRECISION/_PRECISION.md`.
Canonical evidence types are defined in `docs/PRECISION/DATA_TYPE.md`. Runtime
evidence is produced according to `docs/PRECISION/RUNTIME_ENGINE.md`, and the
comparison backtest follows `docs/PRECISION/BACKTEST.md`.

TC: `BOTH:PRECISION_MEASUREMENT`

# A. Purpose

The Precision Checker answers:

> How closely did a backtest reproduce the corresponding production run, and
> where did the two runs first become different?

It must compare five aspects separately:

1. Input precision
2. Decision precision
3. Order-intent precision
4. Execution precision
5. Result precision

The checker must not reduce the comparison to trade count or final PnL. Two
runs can finish with similar PnL while taking different decisions, submitting
different orders, or receiving materially different executions.

# B. Comparison model

A comparison has two independent runs:

```text
Recorded production test case         Backtest result
              |                              |
              +-------- integrity -----------+
                              |
                        normalization
                              |
                          alignment
                              |
             inputs -> decisions -> intents -> executions -> results
                              |
                  scores + first divergence + report
```

Production may mean live or sandbox mode. The report must always identify the
mode; live and sandbox evidence must never be merged into one test case.

The backtest uses simulated exchange execution. It does not use recorded
production exchange responses as its execution source. Execution and financial
results may therefore differ, but the differences must be measured rather than
ignored.

# C. Non-goals

The Precision Checker does not:

- Change strategy or runtime behavior
- Submit, cancel, or modify exchange orders
- Repair or rewrite captured evidence
- Tune the backtest until it matches a chosen production result
- Declare a strategy profitable or safe
- Hide differences by applying undocumented tolerances

# D. Production test-case capture

## D.1 Capture controls

The production dashboard must provide explicit controls:

- **Start Test-Case Capture**
- **Finish Test-Case Capture**
- **Cancel Capture**

Starting or finishing a capture must not start, stop, pause, or otherwise change
trading. Capture observes the normal runtime path and writes evidence through
the monitoring/test-case sink.

Only one capture may be active for the same runtime identity unless concurrent
capture behavior is explicitly designed and tested.

TC: `PROD:PRODUCTION_TEST_CASE_CAPTURE_CONTROLS`

## D.2 Starting a capture

When capture starts, the system must atomically record:

- Test-case identifier and schema version
- Production mode: `live` or `sandbox`
- Actual logical `startT`
- Runtime, strategy, schema, market-data, and execution versions
- Fully resolved effective configuration
- Initial account, position, order, balance, and strategy state
- Active symbols and market subscriptions
- Capture status

A user may schedule a future capture window, but a normal live capture cannot
be created retroactively. Existing logs may be imported only when they contain
all required evidence and pass the same integrity validation.

The displayed start time must be the actual first captured logical boundary,
not merely the time when the user clicked the button.

## D.3 Evidence captured during the run

Trade history alone is insufficient. The capture must retain or reference the
ordered canonical streams required to explain the run:

- Normalized market events visible to the runtime
- Scheduled runtime work and logical clock events needed for alignment
- Strategy decisions, including relevant holds and blocked decisions
- Approved order intentions
- Execution acknowledgements, fills, rejections, cancellations, and errors
- Position, balance, fee, PnL, and strategy-state transitions
- Adapter-call measurements
- Normalized runtime errors and recovery events

Raw exchange payloads may be stored in a separate protected audit. They must not
be required for ordinary scoring when canonical execution evidence is complete.

Capture must be observational. A slow evidence writer must use buffering or
bounded backpressure without changing trading event order.

TC: `PROD:PRODUCTION_TEST_CASE_EVIDENCE`

## D.4 Finishing a capture

When capture finishes, the system must:

1. Record the actual logical `endT`.
2. Finish the current atomic evidence record.
3. Capture final runtime state without closing open positions.
4. Flush every evidence stream.
5. Record counts, byte sizes, and checksums.
6. Validate the manifest and referenced files.
7. Mark the test case `COMPLETE` only after validation succeeds.

Finishing a capture is not a trading event. It must not create a synthetic exit
or otherwise alter production state.

An interrupted, crashed, or manually canceled capture remains `INCOMPLETE` or
`CANCELED`. It must not be silently treated as a complete baseline.

## D.5 Storage layout

A timestamp-only filename such as `live-start-end.json` is not sufficient as
the identity or storage model. Use a stable case directory with a manifest and
bounded evidence files:

```text
production-test-cases/
  <test-case-id>/
    manifest.json
    initial-state.json
    final-state.json
    market-0001.jsonl
    decisions-0001.jsonl
    intents-0001.jsonl
    executions-0001.jsonl
    positions-0001.jsonl
    adapter-calls-0001.jsonl
```

The UI may display friendly names such as `Live · 15–20 Sep 2026`, but the
stable test-case identifier remains authoritative.

Files must be compact, checksummed, bounded in size, and referenced through the
`ProductionTestCaseManifest` defined in `docs/PRECISION/DATA_TYPE.md`.

# E. Comparison inputs

## E.1 Required artifacts

The checker accepts:

```ts
interface PrecisionComparisonInput {
  productionTestCase: ProductionTestCaseSource;
  backtestResult: BacktestResultSource;
  profile: PrecisionProfile;
  accountMap?: Record<string, string>;
  symbolMap?: Record<string, string>;
}
```

The mappings are explicit because production and test environments may use
different opaque account identifiers or normalized symbol aliases. The checker
must never guess an account or symbol mapping.

## E.2 Comparison window

The normal comparison window is the production test case's exact `[startT,
endT]` interval. The backtest must cover that complete interval and use
`KEEP_OPEN` at the matching cutoff.

If a user selects a smaller overlap, the report must identify it as a partial
comparison and exclude state caused before the selected start unless an
equivalent starting-state snapshot exists at that boundary.

The checker must not compare two arbitrary ranges and present the result as a
full production match.

## E.3 Compatibility gate

Before scoring, the checker validates:

- Both manifests and every referenced checksum
- Supported schema versions
- Complete evidence coverage for the requested interval
- Same strategy identity and compatible strategy version
- Equivalent effective strategy configuration
- Compatible runtime, market-data, and numeric-rule versions
- Same exchange trading mode and position mode
- Explicit account and symbol mappings
- Equivalent initial account, position, order, and strategy state
- Compatible backtest end policy

Configuration comparison must use canonical values, not file paths, property
order, environment-variable names, or display labels.

Differences may be allowed only by an explicit comparison profile rule. Every
allowed difference must still appear in the report.

TC: `BOTH:PRECISION_COMPATIBILITY_GATE`

## E.4 Validity states

```ts
type PrecisionComparisonValidity =
  | "VALID"
  | "PARTIAL"
  | "INCOMPLETE"
  | "INCOMPATIBLE"
  | "CORRUPT";
```

- `VALID`: complete, compatible evidence is available.
- `PARTIAL`: the user explicitly selected a valid subset with a valid starting
  state.
- `INCOMPLETE`: required evidence is absent or capture did not finish.
- `INCOMPATIBLE`: versions, configuration, mode, or initial state cannot be
  compared under the selected profile.
- `CORRUPT`: a checksum, count, schema, ordering, or structural invariant fails.

`INCOMPLETE`, `INCOMPATIBLE`, and `CORRUPT` comparisons must not receive a
precision score. The report explains how to make them comparable.

# F. Integrity and normalization

## F.1 Evidence integrity

Before alignment, each stream must be validated independently:

- Event times are finite Unix milliseconds.
- Sequence numbers are valid and deterministic within their scope.
- Stable identifiers are unique where required.
- References point only inside the artifact directory.
- Counts and checksums match the manifest.
- Required causal references resolve.
- Execution totals agree with normalized fills.
- Position summaries agree with their execution evidence.
- Events and state transitions are ordered according to their contract.

Validation errors are evidence problems, not precision differences.

## F.2 Canonical normalization

Both sides must be converted to the same supported canonical schema before
comparison. Normalization may:

- Migrate a supported older schema through a versioned reader
- Apply explicit account and symbol mappings
- Sort object keys for canonical hashing
- Apply the canonical exchange precision and numeric representation
- Remove documented non-semantic fields from equality checks

Normalization must not change a price, quantity, time, decision, reason code,
status, or state value merely to make two records match.

Fields normally excluded from semantic equality include:

- `runId` and environment-specific record identifiers
- Human-readable messages when a stable `reasonCode` exists
- File paths
- Raw provider payloads
- Monitoring wall-clock duration when logical behavior is being compared

Excluded fields remain available as diagnostics where useful.

TC: `BOTH:PRECISION_NORMALIZATION`

# G. Evidence alignment

## G.1 Alignment principle

Production and backtest identifiers are created by different runs and are not
expected to be equal. The checker first pairs records by stable causal and
semantic keys, then compares their values.

Every record receives one alignment status:

```ts
type AlignmentStatus =
  | "PAIRED"
  | "PRODUCTION_ONLY"
  | "BACKTEST_ONLY"
  | "AMBIGUOUS";
```

An unmatched or ambiguous required record counts as a difference. The checker
must not pair records only because their price or result happens to be close.

## G.2 Market-event alignment

Market events are paired by event kind and stable market identity:

- Kline: symbol, interval, `openT`, closed/forming state, and snapshot ordinal
- Volatility point: symbol context and stable volatility-point identifier
- Price: symbol, source, source event time, and observation ordinal
- Volume or funding: symbol, source, source event time, and observation ordinal

After pairing, compare payload values, `t`, `observedT`, and sequence position.
`observedT` must not be placed in the only matching key because its difference
is itself important input-precision evidence.

If both artifacts preserve the same provider event identifier, it should be
used as an additional exact key.

## G.3 Scheduled-work alignment

Scheduled work is paired by account mapping, task identifier, scheduled logical
time, occurrence number, and strategy identity. This reveals skipped, duplicated,
or shifted runtime cycles even when the market data is otherwise identical.

## G.4 Decision alignment

Decisions are paired from already aligned causal work using:

- Mapped account
- Strategy
- Scheduled occurrence or causal market event
- Symbol
- Position lineage and role, when applicable
- Deterministic decision ordinal within the unit of work

Action and reason code are comparison values, not matching keys. Otherwise an
`ENTER` versus `HOLD` divergence would incorrectly appear as two unrelated
records.

## G.5 Order-intent alignment

Intents are paired through their aligned decision plus intent ordinal, position
lineage, kind, and role. Side, order type, quantity, intended price, and reason
are then compared.

## G.6 Execution alignment

Executions are paired through their aligned order intent and submission
ordinal. Individual fills are aligned by exchange fill identity when a shared
identity exists; otherwise they use ordered fill occurrence.

A production partial-fill sequence and one simulated aggregate fill remain one
paired execution with a fill-structure difference. The checker must not invent
synthetic production fills to make the structures equal.

## G.7 Position and result alignment

A logical position lineage begins with an aligned entry intent. Later averaging,
exit, re-entry, and state transitions inherit that mapping.

Hedge role and Streak pair or generation identity must be part of the lineage.
The checker must not pair positions based only on symbol and similar PnL.

## G.8 Ambiguity

If more than one valid pair remains after applying the documented key, mark the
records `AMBIGUOUS`. Use surrounding causal references only when the rule is
deterministic and versioned. Never use a nearest-price, nearest-PnL, or
best-score search to resolve ambiguity.

TC: `BOTH:PRECISION_EVIDENCE_ALIGNMENT`

# H. Precision dimensions

## H.1 Input precision

Input precision measures whether both runs received equivalent normalized
market events and scheduled work in the same order and at equivalent logical
times.

For each paired market event, compare:

- Event kind and symbol
- Interval and candle identity when applicable
- Logical event time and observation time
- Closed/forming status
- Price, OHLC, volume, funding, and volatility-point values
- Ordering relative to other events and scheduled work

Input diagnostics must separately report:

- Missing and extra events
- Value mismatches
- Observation-time drift
- Ordering mismatches
- Coverage gaps
- Stale or corrected provider snapshots

An input mismatch does not automatically prove a strategy bug. It changes the
causal conditions for later decisions.

TC: `BOTH:INPUT_PRECISION`

## H.2 Decision precision

Decision precision compares what the strategy concluded before runtime risk and
execution.

For each paired decision, compare:

- Action: hold, enter, average, exit, or re-enter
- Symbol, direction, position role, and logical position lineage
- Stable reason code
- Strategy-specific decision data used by later logic
- Logical decision time and ordering

Human-readable messages are diagnostic and do not determine equality when the
stable reason code is equal.

The report must show two views:

- **Observed decision precision:** all decisions across the comparison window.
- **Controlled decision precision:** decisions whose causal inputs and prior
  strategy/runtime state are equivalent.

A controlled decision mismatch violates the shared-runtime precision guarantee
and is always critical.

TC: `BOTH:DECISION_PRECISION`

## H.3 Order-intent precision

Order-intent precision compares the approved action after strategy and runtime
risk evaluation but before exchange-specific execution.

For each paired intent, compare:

- Kind: entry, averaging, or exit
- Side, direction, role, and reduce-only behavior
- Order type
- Quantity or quote amount after canonical rounding
- Expected, limit, and stop prices
- Client-order semantic identity and stable reason code
- Logical request time and ordering

Environment-specific `clientOrderId` text may differ, but it must map to the
same semantic intent and remain stable across retries within its run.

As with decisions, report observed and controlled precision. An intent mismatch
is critical when its aligned decision, causal state, configuration, and numeric
rules are equivalent.

TC: `BOTH:ORDER_INTENT_PRECISION`

## H.4 Execution precision

Execution precision compares simulated backtest execution with recorded
production exchange execution for aligned order intentions.

For each paired execution, compare and report:

- Final lifecycle status
- Requested and filled quantity
- Average fill price
- Number and order of partial fills
- Total fees and fee asset normalization
- Request, acknowledgement, first-fill, and final-fill times
- Execution latency
- Slippage from the same expected-price convention
- Rejection, cancellation, expiry, and error codes

The report must include both signed and absolute differences. A signed price or
slippage difference shows which run received the worse fill; the absolute value
shows magnitude.

Execution differences are expected in live trading and do not by themselves
prove incorrect runtime logic. They can, however, cause later state and decision
differences and must be preserved as causal divergence points.

TC: `BOTH:EXECUTION_PRECISION`

## H.5 Result precision

Result precision compares canonical state after aligned events and at the final
cutoff.

Compare at minimum:

- Open, closed, and pending position status
- Entry, averaging, and exit execution summaries
- Position quantity and average entry price
- Margin, leverage, exposure, and reserved balance
- Realized and unrealized PnL
- Fees and funding
- Account balance and available balance
- Strategy-specific position and account state
- Final open orders and positions

Result comparison must use `KEEP_OPEN` semantics at the production cutoff.
Unrealized PnL uses an explicitly identified common mark-price observation so a
different mark source is not mistaken for an accounting error.

The report must distinguish:

- A result difference explained by an earlier execution difference
- A result difference explained by an earlier input or decision difference
- An unexplained accounting or state-transition difference after equivalent
  evidence

The third case is critical.

TC: `BOTH:RESULT_PRECISION`

# I. Exact equality and tolerances

## I.1 Exact fields

The following are exact after canonical normalization:

- Event type, action, side, direction, role, order type, status, and reason code
- Stable semantic ordering
- Schema and strategy discriminators
- Boolean risk and execution flags
- Canonically rounded decision and intent values when their causal inputs and
  state are equivalent

Do not apply a broad floating-point tolerance to hide decision or order-intent
drift. Numeric calculations should use the same canonical rounding utility
before evidence is written.

## I.2 Numeric comparison

Execution and result values may use both an absolute and relative tolerance:

```text
delta = abs(productionValue - backtestValue)

allowedDelta =
  absoluteTolerance
  + max(abs(productionValue), abs(backtestValue))
    * relativeTolerancePct / 100

passes = delta <= allowedDelta
```

Using both forms avoids unstable percentages near zero while still scaling for
large positions. The report always shows raw values and delta even when the
check passes.

Time uses an explicit millisecond tolerance. Price may additionally be reported
in basis points. Quantity, fees, balances, and PnL must identify their unit.

## I.3 Precision profile

Every comparison uses a named, versioned profile:

```ts
interface NumericTolerance {
  absolute: number;
  relativePct: number;
}

interface PrecisionProfile {
  id: string;
  version: number;
  input: {
    observedTimeMs: number;
    price: NumericTolerance;
    volume: NumericTolerance;
  };
  execution: {
    fillPrice: NumericTolerance;
    quantity: NumericTolerance;
    feeUsdt: NumericTolerance;
    latencyMs: number;
  };
  result: {
    balanceUsdt: NumericTolerance;
    pnlUsdt: NumericTolerance;
    positionQuantity: NumericTolerance;
  };
  passThresholds?: Partial<Record<PrecisionCategory, number>>;
}
```

The exact fields and complete profile shape belong in
`docs/PRECISION/DATA_TYPE.md` when implemented.

Profiles must be stored with the report. Changing a profile creates a new
report result; it must not overwrite the meaning of an earlier score.

No tolerance may be inferred from the observed difference. Tolerances are
selected before scoring.

TC: `BOTH:PRECISION_TOLERANCE_PROFILE`

# J. Scoring

## J.1 Record equivalence

A paired record is equivalent when every required comparison for its category
passes. Production-only, backtest-only, and ambiguous required records are not
equivalent.

For a category with at least one record:

```text
denominator = max(productionRecordCount, backtestRecordCount)
categoryScore = equivalentRecordCount / denominator * 100
```

This prevents extra or missing records from disappearing from the score. Each
category also reports field-level sub-scores and raw error distributions so one
failed field can be understood.

If both sides legitimately contain no records for a category, its score is
`N/A`, not automatically `100`. For example, a no-trade window may have no
execution score.

## J.2 Required category scores

```ts
type PrecisionCategory =
  | "INPUT"
  | "DECISION"
  | "ORDER_INTENT"
  | "EXECUTION"
  | "RESULT";

interface PrecisionCategoryScore {
  category: PrecisionCategory;
  score?: number;
  productionCount: number;
  backtestCount: number;
  pairedCount: number;
  equivalentCount: number;
  productionOnlyCount: number;
  backtestOnlyCount: number;
  ambiguousCount: number;
}
```

Decision and intent sections additionally include their controlled scores and
the number of records excluded from controlled comparison because prior causal
state already differed.

## J.3 Overall score

The five category scores are the primary result. When an overall number is
needed, use the minimum applicable category score:

```text
overallScore = min(applicableCategoryScores)
```

This conservative rule prevents a high PnL or input score from averaging away
a serious decision or execution difference. `N/A` categories are listed and
excluded from the minimum; if no meaningful category is scoreable, the overall
score is `N/A`.

The overall score must always be displayed with the five category scores and
the first divergence. It must never appear alone.

## J.4 Outcome

```ts
type PrecisionComparisonOutcome =
  | "PASS"
  | "FAIL"
  | "MEASURED"
  | "NOT_COMPARABLE";
```

- `PASS`: every configured threshold passes and there is no critical controlled
  invariant violation.
- `FAIL`: a threshold fails or a critical invariant is violated.
- `MEASURED`: scoring succeeded, but the selected profile has no complete
  pass/fail thresholds.
- `NOT_COMPARABLE`: the compatibility or integrity gate failed.

Decision and order-intent precision must be `100` within every controlled
segment. An unexplained result mismatch after equivalent execution evidence is
also a critical failure, regardless of the overall numeric score.

Execution and result pass thresholds must be explicitly calibrated and
versioned. Until those thresholds are chosen, the checker reports `MEASURED`
rather than inventing a standard.

TC: `BOTH:PRECISION_SCORING`

# K. First divergence and causality

## K.1 Divergence ordering

The checker examines aligned evidence in logical order. Divergences are ordered
by:

1. Logical time
2. Runtime event priority
3. Sequence number
4. Causal category: input, decision, order intent, execution, then result
5. Stable field path

The report identifies both the first observed divergence and the first critical
unexplained divergence when they are different.

## K.2 Divergence record

```ts
type DivergenceCause =
  | "INPUT"
  | "SCHEDULING"
  | "STRATEGY_DECISION"
  | "RISK_OR_INTENT"
  | "EXCHANGE_EXECUTION"
  | "ACCOUNTING_OR_STATE"
  | "EVIDENCE_GAP"
  | "UNKNOWN";

interface PrecisionDivergence {
  id: string;
  t: number;
  category: PrecisionCategory;
  cause: DivergenceCause;
  severity: "INFO" | "WARNING" | "CRITICAL";
  field: string;
  productionValue?: unknown;
  backtestValue?: unknown;
  absoluteDelta?: number;
  relativeDeltaPct?: number;
  tolerance?: unknown;
  productionRef?: string;
  backtestRef?: string;
  causedByDivergenceId?: string;
  explanation: string;
}
```

## K.3 Root cause and cascade

The checker follows causal references forward:

- Different input may explain a later different decision.
- Different execution may explain later balance, position, or decision state.
- Equal decision with different intent points to risk, sizing, or runtime drift.
- Equal execution evidence with different state points to accounting or
  state-transition drift.

A downstream difference remains visible but references its earliest known
cause through `causedByDivergenceId`. The checker must not count a causal cascade
as several unrelated root causes.

If causality cannot be proven, use `UNKNOWN`; do not guess.

TC: `BOTH:PRECISION_FIRST_DIVERGENCE`

# L. Comparison report

The checker produces an immutable, versioned report:

```ts
interface PrecisionReport {
  schema: number;
  id: string;
  createdT: number;
  checkerVersion: number;
  productionTestCaseId: string;
  productionManifestSha256: string;
  backtestRunId: string;
  backtestManifestSha256: string;
  profile: {
    id: string;
    version: number;
  };
  window: {
    startT: number;
    endT: number;
  };
  validity: PrecisionComparisonValidity;
  outcome: PrecisionComparisonOutcome;
  overallScore?: number;
  scores: PrecisionCategoryScore[];
  firstDivergence?: PrecisionDivergence;
  firstCriticalDivergence?: PrecisionDivergence;
  divergences: EvidenceFileRef[];
  diagnostics: {
    compatibility: EvidenceFileRef;
    coverage: EvidenceFileRef;
    adapterCalls?: EvidenceFileRef;
  };
}
```

The exact persisted report types belong in `docs/PRECISION/DATA_TYPE.md` when
implemented.

The human-readable report must show:

- What was compared
- Whether the evidence was valid and compatible
- Production and backtest coverage
- The five category scores and overall score
- Controlled decision and intent scores
- First observed and first critical divergence
- Root-cause chain and downstream effects
- Missing, extra, ambiguous, and excluded records
- Largest execution and result differences
- Applied tolerances and profile version
- Adapter-call and error diagnostics
- Direct links or stable references to supporting evidence

TC: `BOTH:PRECISION_REPORT`

# M. Checker service and page

## M.1 Grouped checker API

The checker should expose one grouped public API:

```ts
const precisionChecker = {
  capture: {
    start(options: CaptureStartOptions): Promise<CaptureStatus> {
      // Production or sandbox capture boundary.
    },
    finish(captureId: string): Promise<ProductionTestCaseManifest> {
      // Finalize, hash, and validate captured evidence.
    },
    cancel(captureId: string): Promise<CaptureStatus> {
      // Preserve an explicitly canceled artifact.
    },
  },
  comparison: {
    validate(input: PrecisionComparisonInput): Promise<CompatibilityReport> {
      // Integrity and compatibility gate.
    },
    run(input: PrecisionComparisonInput): Promise<PrecisionReport> {
      // Stream, align, compare, and score.
    },
  },
};

export default precisionChecker;
```

The UI must call this boundary rather than reimplement alignment or scoring in
React components.

## M.2 Precision Checker page

The `/precision-checker` page must allow the user to:

- Select one complete production test case
- Select or launch a compatible backtest
- Select a named precision profile
- Review compatibility before running the comparison
- Run or cancel a comparison
- See progress for large evidence streams
- Inspect all category scores
- Open the first divergence and its causal evidence
- Filter divergences by category, severity, symbol, account, and time
- Inspect configuration, version, and initial-state differences
- Export or reopen the immutable report

The page must not show only a single percentage. It must make a critical
decision, intent, execution, or accounting difference visible without requiring
the user to inspect raw JSON manually.

TC: `BTEST:PRECISION_CHECKER_PAGE`

# N. Performance and safety

- Validate manifests before loading large evidence files.
- Stream ordered evidence and use bounded merge alignment where possible.
- Build indexes only for identifiers or causal mappings that require random
  access.
- Do not load a multi-day production capture and backtest fully into memory
  without need.
- Cancellation must preserve a non-complete report status.
- Re-running the same comparison with identical artifact hashes, checker
  version, and profile must produce the same report content.
- Comparison artifacts are read-only. Never mutate their source evidence.
- Reject unsafe relative paths and checksum mismatches.
- Redact secrets and protected raw exchange fields from the UI and exported
  report.

TC: `BOTH:PRECISION_CHECKER_SAFETY`

# O. Validation requirements

At minimum, automated tests must prove:

- Production capture does not change trading decisions or state.
- Starting and finishing capture records exact boundaries and state snapshots.
- Interrupted capture cannot be marked complete.
- Trade history without input, decision, and intent evidence is incomplete.
- Corrupt checksums and unsafe paths are rejected before scoring.
- Incompatible strategy, configuration, mode, and initial state are reported.
- Account and symbol mappings are explicit and deterministic.
- Market events with different observation times can align and expose the time
  difference.
- `ENTER` versus `HOLD` becomes one decision mismatch, not two unmatched
  records.
- Missing and extra records reduce the relevant category score.
- Ambiguous records are never paired by best result.
- Exact controlled decisions and order intentions score `100`.
- A controlled decision or intent mismatch is a critical failure.
- Execution price, quantity, fee, latency, partial-fill, rejection, and
  cancellation differences use the selected profile.
- Numeric tolerance works near zero and for large values.
- Result comparison uses a common mark price and preserves open positions.
- The first divergence follows logical priority and sequence ordering.
- Downstream divergences reference their root cause.
- Overall score cannot exceed the lowest applicable category score.
- A category with no legitimate records reports `N/A`.
- A profile without calibrated thresholds produces `MEASURED`, not `PASS`.
- Large reports can be compared in bounded memory without changing results.
- Repeated comparison of identical artifacts is deterministic.

# P. Implementation order

1. Finalize the persisted precision profile and report types in
   `docs/PRECISION/DATA_TYPE.md`.
2. Implement production test-case capture through the runtime monitoring sink.
3. Implement integrity, schema migration, and compatibility validation.
4. Implement streaming alignment for inputs and scheduled work.
5. Add decision, intent, execution, position, and state alignment.
6. Implement tolerance evaluation and separate category scores.
7. Add first-divergence and causal-cascade classification.
8. Persist immutable reports.
9. Build the `/precision-checker` page on the checker service.
10. Calibrate versioned execution and result thresholds from representative
    production cases; do not derive them from the case currently being scored.

# Q. Related documents

- `docs/PRECISION/_PRECISION.md`
- `docs/PRECISION/RUNTIME_ENGINE.md`
- `docs/PRECISION/DATA_TYPE.md`
- `docs/PRECISION/BACKTEST.md`
- `docs/PRECISION/PAGES.md`
- `docs/PRECISION/FOLDER.md`
