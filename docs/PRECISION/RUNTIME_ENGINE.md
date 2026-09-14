# Shared Runtime Engine

This document defines the high-level architecture and behavioral contract of the
runtime engine described in `docs/PRECISION/_PRECISION.md`.

The exact persisted types are defined in `docs/PRECISION/DATA_TYPE.md`. The
historical-data and simulated-execution rules are defined in
`docs/PRECISION/BACKTEST.md`.

# A. Purpose

The system must have one runtime engine for backtest, sandbox, and live trading.
The engine must execute the same strategy lifecycle, event ordering, scheduling,
decision, risk, execution, accounting, and state-transition flow in every mode.

Only adapters may change between modes:

- Backtest uses historical market data, a simulated clock, simulated execution,
  and isolated backtest storage.
- Sandbox uses live market data, a real clock, simulated execution, and sandbox
  storage.
- Live uses live market data, a real clock, real exchange execution, and live
  storage.

TC: `BOTH:SHARED_RUNTIME_ENGINE`

# B. Core guarantees

## B.1 One orchestration path

Production and backtest must not have separate implementations of entry,
averaging, exit, position accounting, or strategy decisions.

The following path must be shared:

```text
Market events and scheduled work
                |
                v
       Shared runtime engine
                |
                v
          Strategy plugin
                |
                v
        Decisions and intents
                |
                v
       Risk and execution flow
                |
                v
       Orders, fills, and state
```

A mode may change how an adapter obtains data or performs execution. It must not
change the trading logic processed by the engine.

## B.2 Deterministic decisions

Given equivalent normalized inputs, logical time, initial state, strategy,
configuration, and execution results, the engine must produce identical
decisions, order intentions, and state transitions.

The engine and strategy must not read uncontrolled external state. They must not
call `Date.now()`, access an exchange directly, read arbitrary files, or use
unseeded randomness. Time and external information must come through explicit
runtime contracts.

TC: `BOTH:RUNTIME_DETERMINISTIC_DECISIONS`

## B.3 Explicit differences

Backtest and production differences must be visible at adapter boundaries. The
engine must not contain scattered checks such as `if backtest` or `if live` to
select different business logic.

Mode-specific capabilities are selected when the runtime is created. For
example, the live execution adapter submits an order to an exchange while the
backtest execution adapter simulates the same order-intent contract.

## B.4 Strategy independence

The runtime must not contain business rules that belong only to Multi, Hedge, or
Streak. Each strategy supplies those rules through the same strategy contract.
Adding a future strategy must not require copying or rewriting the engine.

TC: `BOTH:PLUGIN_STRATEGY`

# C. Runtime composition

The runtime is assembled once at its composition boundary. The following shape
is illustrative; exact fields belong in `docs/PRECISION/DATA_TYPE.md`.

```ts
type RuntimeMode = "backtest" | "sandbox" | "live";

interface RuntimeOptions {
  mode: RuntimeMode;
  config: RuntimeConfig;
  strategy: StrategyPlugin;
  adapters: {
    market: MarketAdapter;
    clock: ClockAdapter;
    execution: ExecutionAdapter;
    storage: StorageAdapter;
    monitoring: MonitoringAdapter;
  };
}

interface RuntimeEngine {
  start(): Promise<void>;
  run(): Promise<RuntimeResult>;
  stop(reason: RuntimeStopReason): Promise<void>;
  status(): RuntimeStatus;
}

const runtimeEngine = {
  create(options: RuntimeOptions): RuntimeEngine {
    // Implementation is defined later.
  },
};

export default runtimeEngine;
```

Callers must import one grouped runtime API. Runtime internals must not be
exposed as unrelated public helper functions.

# D. Responsibilities

## D.1 Runtime engine

The runtime engine owns:

- Lifecycle: initialize, start, run, stop, and recover
- Event validation, ordering, and dispatch
- Logical-time advancement and scheduled work
- Loading and persisting runtime state
- Calling the selected strategy plugin
- Converting approved decisions into order intentions
- Risk and balance authorization
- Routing order intentions to the execution adapter
- Applying order and fill results exactly once
- Position, balance, fee, and PnL accounting
- Correlation identifiers and audit events
- Failure isolation and controlled shutdown

The engine does not own exchange-specific API code, historical-data loading, UI
rendering, or strategy-specific trading rules.

## D.2 Strategy plugin

The strategy plugin owns:

- Strategy identity and schema version
- Required market-data subscriptions and intervals
- Entry, averaging, exit, and re-entry decisions
- Strategy-specific position state
- Strategy-specific scheduling requirements
- Strategy-specific validation and diagnostics

The strategy receives a read-only decision context and returns decisions. It
must not submit exchange orders, persist files, or mutate account state
directly.

```ts
interface StrategyPlugin {
  metadata: {
    id: "multi" | "hedge" | "streak" | string;
    version: number;
  };
  requirements: StrategyRequirements;
  initialize(context: StrategyInitializationContext): StrategyState;
  evaluate(context: StrategyDecisionContext): StrategyDecision[];
}
```

Multi, Hedge, and Streak may produce different decisions and maintain different
strategy state, but they must use this same lifecycle.

## D.3 Market adapter

The market adapter supplies normalized market events without exposing
exchange-specific or dataset-specific shapes to the engine.

It owns:

- Historical dataset reading in backtest
- REST or WebSocket market-data access in sandbox and live
- Symbol and interval translation
- Kline, price, volume, funding, and volatility-source normalization
- Source timestamps and data-availability timestamps
- Deduplication of provider messages
- Provider-level caching and rate-limit coordination

The adapter must distinguish a forming candle from a closed candle. It must not
make future candle information visible before that information would have been
available in production.

The existing system runs Speedup on a one-minute cadence while parts of its
shared market context use five-minute klines and execution may use one-minute
klines. The normalized contract must preserve the requested interval and candle
visibility explicitly; it must not treat scheduling cadence and candle interval
as the same concept.

TC: `BOTH:MARKET_ADAPTER`

## D.4 Clock adapter

The clock adapter is the only source of time for the runtime and strategies.

- Backtest advances simulated time to the next event without waiting in real
  time.
- Sandbox and live follow real time.
- Scheduled work is defined against logical time in every mode.
- Timestamps persisted by the engine must identify their meaning, such as event
  time, request time, acknowledgement time, and fill time.

TC: `BOTH:RUNTIME_CLOCK`

## D.5 Execution adapter

The execution adapter receives normalized order intentions and returns
normalized execution events.

It owns:

- Exchange-specific symbols, precision, and order parameters
- Order submission, amendment, and cancellation
- Simulated fills in backtest and sandbox
- Real exchange communication in live mode
- Acknowledgements, fills, partial fills, rejections, and cancellations
- Exchange order identifiers and error normalization
- Exchange-level retry and rate-limit handling
- Live order and position reconciliation

The execution adapter must not decide whether the strategy should enter,
average, or exit. It performs or simulates an already-authorized intention.

TC: `BOTH:EXECUTION_ADAPTER`

## D.6 Storage adapter

The storage adapter owns durable and isolated state for a runtime run.

It must support:

- Loading the initial configuration and state
- Atomic checkpoints after state-changing work
- Schema and strategy version information
- Separate live, sandbox, and backtest namespaces
- Compact persistence for normal runtime state
- References to larger execution-audit or production-test-case records

The backtest adapter must never read or write live account state.

TC: `BOTH:STORAGE_ADAPTER`

## D.7 Monitoring adapter

The monitoring adapter observes the runtime but must not change trading
decisions.

It receives structured events for:

- Runtime, cycle, and strategy lifecycle
- Market and exchange adapter calls
- Decisions and order intentions
- Orders, acknowledgements, fills, and failures
- State persistence
- Duration, retry, cache, and rate-limit measurements
- Skipped or blocked actions and their reasons

The production-test-case recorder and Precision Checker evidence must be built
from these structured events and canonical runtime state, not from parsing log
messages.

TC: `BOTH:RUNTIME_MONITORING`

# E. Event and time model

## E.1 Event envelope

Every event entering or leaving the engine must have a common envelope:

```ts
interface RuntimeEvent<TType extends string, TPayload> {
  id: string;
  runId: string;
  type: TType;
  t: number;
  seq: number;
  payload: TPayload;
}
```

- `t` is logical event time.
- `seq` provides deterministic ordering when events share the same logical time.
- Provider receipt, request, acknowledgement, and fill times remain separate
  payload fields when relevant.
- Event identifiers must remain stable inside one recorded run.

The exact event union is defined in `docs/PRECISION/DATA_TYPE.md`.

## E.2 Ordering

The runtime processes one ordered event stream. Ordering must not depend on
promise completion timing, network response timing, object-key order, or
filesystem traversal order.

Events are ordered by:

1. Logical time
2. Explicit runtime priority
3. Sequence number

The priority of work that can change balances or positions must be explicit and
tested. At minimum, risk and forced-exit work must run before normal exits,
normal exits before averaging, and averaging before new entries when they are
due at the same logical time.

TC: `BOTH:RUNTIME_EVENT_ORDER`

## E.3 Candle visibility

The runtime may consume one-minute candles, five-minute candles, volatility
points, or other normalized events according to strategy requirements.

A backtest may only expose information that production could have observed at
the same logical time. For example, at 10:03 it must not expose the final close
of the 10:00-10:05 candle. If production evaluates a forming five-minute candle
once per minute, the backtest dataset or market adapter must reproduce the
corresponding visible snapshots.

TC: `BOTH:MARKET_DATA_VISIBILITY`

# F. Shared execution cycle

For each event or scheduled unit of work, the engine runs the same ordered
phases:

1. Advance the logical clock.
2. Validate and apply the incoming event.
3. Load or refresh the market snapshot required for this work.
4. Reconcile external execution state when the adapter requires it.
5. Build an immutable strategy decision context.
6. Ask the strategy plugin for decisions.
7. Validate decisions against runtime risk, balance, and position rules.
8. Convert approved decisions into idempotent order intentions.
9. Persist the intention before external submission when required for recovery.
10. Send the intention through the execution adapter.
11. Apply acknowledgements and fills exactly once.
12. Update orders, positions, balances, fees, PnL, and strategy state.
13. Persist a checkpoint.
14. Publish monitoring and production-test-case evidence.

An exit has priority over averaging for the same position. A position closed in
the current unit of work must not be averaged or closed again.

TC: `BOTH:RUNTIME_EXECUTION_CYCLE`

# G. Scheduling and current production stages

The engine owns a generic logical-time scheduler. A strategy and runtime
configuration declare scheduled work; separate production-only loops are not
allowed.

The first migrated strategy must represent the existing production work:

- Risk Sentinel
- Speedup monitoring
- Standard Monitoring
- Management
- Capture Entry

Their configured cadences and eligibility rules must be preserved during
migration. Backtest must trigger the equivalent work from the simulated clock,
using the same priority and runtime phases as production. Backtest speed is an
implementation detail: advancing six months quickly must not change logical
cadence or event visibility.

Stage names are not hardcoded requirements for every future strategy. A future
strategy may declare different scheduled work through the same scheduler
contract.

TC: `BOTH:RUNTIME_SCHEDULING`

# H. Order lifecycle and execution evidence

Every execution follows a traceable lifecycle:

```text
Strategy decision
      -> approved order intention
      -> submission requested
      -> acknowledged or rejected
      -> partially or fully filled
      -> canceled, expired, or completed
```

Every step must carry correlation identifiers so the Precision Checker can
match production and backtest evidence.

The runtime must preserve expected price, average fill price, quantity, fees,
request time, acknowledgement time, fill time, and final status for each entry,
averaging, and exit execution. Slippage and latency are computed from this
evidence. A position may contain multiple execution summaries; complete raw
exchange requests and responses belong in the separate execution audit.

TC: `BOTH:EXECUTION_EVIDENCE`

# I. State, recovery, and idempotency

Before submitting a state-changing external command, the runtime must create a
stable intention identifier and preserve enough information to reconcile an
uncertain result.

After restart, live mode must:

1. Load the latest durable checkpoint.
2. Query the execution adapter for relevant open orders and positions.
3. Reconcile local and exchange state.
4. Resolve pending intentions without submitting duplicates.
5. Continue from the next valid logical unit of work.

The same execution event must never be applied twice. Adapter retries must reuse
the same idempotency or client-order identifier whenever the exchange supports
it. An uncertain write must be reconciled before another submission is made.

TC: `PROD:RUNTIME_RECOVERY`

# J. Accounts and scalability

Public market data should be fetched once and shared safely across eligible
accounts when exchange, market, interval, and logical visibility are equivalent.
Account balances, positions, orders, strategy state, and credentials must remain
isolated.

Balance-changing work for one account must be serialized. A failure in one
account must not corrupt or overwrite another account's state.

Backtest data should be streamed or processed in bounded batches when possible;
running a long period must not require duplicating the complete dataset for each
account or strategy. Market caches and API-call coalescing must preserve the
event-visibility contract.

TC: `BOTH:RUNTIME_SCALABILITY`

# K. Safety rules

- Backtest execution must be structurally unable to submit real orders.
- Sandbox and live storage, credentials, orders, and balances must be isolated.
- Runtime mode and selected strategy must not change silently during a run.
- Live startup must validate exchange and account capabilities required by the
  selected strategy, including position mode and supported order behavior.
- Strategy decisions must pass centralized balance, position, and risk checks
  before execution.
- Adapter errors, retries, fallbacks, stale data, and rate limits must be visible
  through monitoring events.
- A failed persistence operation must not be reported as a successful completed
  cycle.

TC: `BOTH:RUNTIME_MODE_SAFETY`

# L. Configuration and versioning

Every run must resolve one immutable effective configuration containing:

- Runtime mode and runtime settings
- Strategy identifier, version, and settings
- Exchange and market settings
- Data intervals and scheduling rules
- Execution simulation or live execution settings
- Initial account and position state
- Runtime implementation and persisted-schema versions

The effective configuration must be recorded with backtest results and
production test cases. Environment variables and defaults must be resolved
before recording so a comparison does not depend on unavailable implicit
values.

TC: `BOTH:RUNTIME_CONFIG_SNAPSHOT`

# M. Validation requirements

The runtime design is accepted when tests prove that:

- The same strategy plugin runs in backtest, sandbox, and live composition.
- Equivalent normalized inputs produce identical decisions and order intentions.
- Backtest logical scheduling matches production scheduling without real-time
  waiting.
- Forming and closed candles cannot introduce future information.
- Coincident work follows deterministic priority.
- Exit prevents averaging or duplicate exit in the same work unit.
- Backtest cannot reach a real execution adapter or live storage.
- Partial fills, rejections, cancellations, and retries update state correctly.
- Restart reconciliation does not submit or apply an order twice.
- Multi-account public data is shared while private state remains isolated.
- Monitoring records adapter counts, durations, errors, retries, and rate-limit
  evidence without changing decisions.

These behaviors use `BOTH:` testing codes when they apply to backtest and
production. Live-only recovery and exchange behaviors use `PROD:`.

# N. Migration direction

1. Inventory the behavior and configuration used by Multi, Hedge, and Streak.
2. Define the shared event, decision, order, execution, and position types.
3. Implement the runtime contracts and adapters without changing strategy
   behavior.
4. Migrate one reference strategy and prove backtest/sandbox/live parity.
5. Migrate the remaining strategies one at a time.
6. Compare production test cases with equivalent backtests through the Precision
   Checker.
7. Remove a legacy runtime only after its migrated strategy passes the required
   behavior and precision checks.

The migration must preserve existing persistent data through compatible reads
or explicit versioned migrations.

# O. Related documents

- `docs/PRECISION/_PRECISION.md`: project backbone
- `docs/PRECISION/DATA_TYPE.md`: canonical contracts and persisted schemas
- `docs/PRECISION/BACKTEST.md`: historical data and simulated execution
- `docs/PRECISION/PRECISION_CHECKER.md`: production/backtest comparison
- `docs/PRECISION/FOLDER.md`: implementation boundaries and folder structure
- `docs/PRECISION/PAGES.md`: dashboard responsibilities
