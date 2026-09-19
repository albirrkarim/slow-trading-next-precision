# Shared Runtime Engine — V1

Status: implementation plan for the Multi strategy foundation.

The engine will live under `src/lib/precision`. It will extract the proven
behavior from Multi's `src/lib/slowTrading` and `src/lib/trading`; it will not
create an event framework or redesign strategy rules.

# A. Goal

Live, sandbox, and backtest must call the same runtime cycle for decisions,
entry, averaging, exit, accounting, and position updates. The only differences
between modes are their adapters for time, market data, execution, storage, and
operational side effects.

That is the final architecture, not the scope of the first implementation
phase. V1 is delivered backtest-first:

```text
src/lib/dev/backtestPrecision/api/run.ts
  -> backtest child/runner
  -> shared-capable Precision runtime engine
```

The current production path, including `src/instrumentation.ts` and
`src/lib/slowTrading/**` orchestration, remains unchanged during this phase.
The engine contracts must be capable of accepting production adapters later,
so production can adopt the same engine without a redesign.

```text
                       shared runtime engine
                    /          |           \
               strategy     trading      accounting
                  logic       actions      + state
                    ^            ^           ^
                    |            |           |
             environment adapters selected during initialization
              live          sandbox          backtest
```

The engine owns ordering and state transitions. Adapters provide facts or
perform effects, but they do not decide what the strategy should do.

TC: `BOTH:SHARED_RUNTIME_ENGINE`

# B. Clarification of the clock and cadence

Every mode has a clock.

- Live and sandbox use a system-clock adapter. The scheduler waits for real
  aligned minute closes, then asks the engine to process that logical time.
- Backtest uses a dataset-clock adapter. It advances through historical
  one-minute closes without real waiting.

The engine therefore never reads `Date.now()` inside strategy, trading, or
accounting decisions. The logical time supplied by the clock is authoritative.
Wall-clock time may still be used outside decisions to measure performance.

Backtest advances one logical minute at a time, even when only five-minute
stages are due less often. This is necessary because Risk Sentinel and Speedup
may run every minute. It does **not** rerun all positions every minute:

```text
12:00  Risk -> Speedup -> Standard -> Management -> Capture Entry
12:01  Risk -> Speedup
12:02  Risk -> Speedup
12:03  Risk -> Speedup
12:04  Risk -> Speedup
12:05  Risk -> Speedup -> Standard -> Management -> Capture Entry
```

At the one-minute passes, Speedup receives only positions currently owned by
Speedup. Standard positions wait for the next Standard pass. At a five-minute
boundary, due stages still run in the fixed order shown above.

This produces the intended `5m -> 1m -> 1m -> 1m -> 1m -> 5m` behavior while
preserving the same scheduler rules in production and backtest.

TC: `BOTH:RUNTIME_LOGICAL_CLOCK`

# C. Initialization and lifecycle

An environment driver initializes one engine instance with all required
dependencies. In the current phase, that driver is the Precision Backtest
runner. A run must not switch mode, strategy, account catalog, or storage scope
after initialization.

```ts
interface RuntimeEngineInput {
  mode: "live" | "sandbox" | "backtest";
  clock: RuntimeClock;
  market: MarketSource;
  execution: ExecutionSource;
  storage: RuntimeStorage;
  strategy: StrategyPlugin;
  config: RuntimeConfig;
  metrics: RuntimeMetrics;
  logger: RuntimeLogger;
}

interface RuntimeClock {
  now(): number;
}

interface MarketSource {
  snapshot(input: MarketRequest): Promise<MarketSnapshot>;
}

interface ExecutionSource {
  execute(action: TradingAction): Promise<ExecutionResult>;
}

interface RuntimeStorage {
  load(scope: StorageScope): Promise<RuntimeState>;
  commit(scope: StorageScope, state: RuntimeState): Promise<void>;
}

interface StrategyPlugin {
  id: StrategyId;
  decide(input: StrategyInput): Promise<StrategyDecision>;
}
```

The concrete types should reuse the current Multi types wherever they already
represent the required data. These contracts describe ownership; they are not
permission to replace proven position, configuration, or exchange types.

The public API should be grouped:

```ts
precision.runtime.create(input)
precision.runtime.schedule.getDueStages(input)
engine.runMinute({ t })
engine.runStage({ stage, t })
backtest.runner.run(input) // owns historical range iteration
```

Initialization validates before any cycle starts:

- The mode matches the execution and storage adapters.
- At least one account and symbol are configured.
- Stage intervals are positive whole minutes.
- The strategy configuration is valid.
- Backtest coverage includes warmup, start, and end times.
- Backtest storage is isolated and operational side effects are disabled.

TC: `BOTH:RUNTIME_INITIALIZATION`

# D. Engine boundaries

## D.1 Engine responsibilities

The shared engine owns:

- Selecting due stages for a logical time.
- Enforcing stage, account, symbol, position, and action order.
- Loading the latest configuration and state before work begins.
- Sharing public market preparation across accounts.
- Calling the strategy and shared trading functions.
- Applying execution results to balance and position state.
- Persisting each completed state-changing action.
- Recording deterministic diagnostics and metrics.

## D.2 Adapter responsibilities

- `clock` supplies logical Unix-millisecond time.
- `market` returns only information visible at that logical time.
- `execution` submits an order or produces a deterministic simulated fill.
- `storage` loads and atomically saves mode-and-account-isolated state.
- `strategy` converts runtime facts into decisions and never accesses exchange,
  storage, notifications, or the wall clock directly.

Notification, withdrawal, MCP, dashboard, and HTTP behavior are outside the
shared trading engine. Production may react to engine results through separate
operational services. Backtest does not initialize those services.

TC: `BOTH:RUNTIME_ADAPTER_BOUNDARIES`

# E. Scheduling and deterministic order

The default stages are:

| Order | Stage               | Default cadence | Primary responsibility |
| ----: | ------------------- | --------------: | ---------------------- |
| 1     | Risk Sentinel       |        1 minute | Shared risk evidence and account protection |
| 2     | Speedup             |        1 minute | Urgent open positions only |
| 3     | Standard Monitoring |       5 minutes | Remaining open positions |
| 4     | Management          |       5 minutes | Coin-list maintenance; no trading actions |
| 5     | Capture Entry       |       5 minutes | Symbols without an open position |

A stage is due when the UTC epoch-minute is divisible by its configured
interval. Risk Sentinel remains a one-minute safety stage. Configurable
intervals retain their existing normalization rules.

For one logical time, ordering is always:

1. Due stages in the table order.
2. Accounts in configured catalog order.
3. Symbols in uppercase alphabetical order.
4. Positions in stable persisted order.
5. Actions in the priority defined in Section G.

Only one mutation cycle may run at a time for a mode. A completed duplicate
`mode + account + stage + logical time` is ignored. Production records and
skips a missed aligned cycle instead of replaying historical trading work.
Backtest processes every required logical minute and fails if one is missing.

TC: `BOTH:RUNTIME_SCHEDULING`
TC: `BOTH:RUNTIME_DETERMINISTIC_ORDER`
TC: `PROD:RUNTIME_MISSED_CYCLE_POLICY`

# F. Stage ownership

## F.1 Risk Sentinel

Capture public BTC and market-breadth evidence once. Apply that immutable
evidence to each account sequentially. It may block entry or request forced
exits, but account protection state and notifications remain account-specific.

## F.2 Speedup

Select open positions using the existing persisted Speedup rules. Speedup owns
only those selected positions for that cycle. Standard Monitoring must not
process them again at the same logical time.

## F.3 Standard Monitoring

Select every open position not owned by Speedup. Refresh its normal monitoring
state and allow exit or averaging according to the existing strategy rules.
Updated persisted state may make the position eligible for a later Speedup
pass; it does not cause a second pass in the current stage.

## F.4 Management

Evaluate configured symbols for the existing coin-management rules. It does
not run entry, averaging, exit, balance authorization, or position PnL work.

## F.5 Capture Entry

Select configured symbols without an open position. Prepare entry candidates,
then apply account-specific guards, worker capacity, used-vPoint checks,
balance authorization, and final execution-price checks. A disabled account
cannot enter, but an account with an open position remains eligible for exit
monitoring.

TC: `BOTH:RUNTIME_STAGE_OWNERSHIP`

# G. One stage cycle

For each due stage, the engine follows this sequence:

1. Load the latest runtime configuration, account catalog, and scoped state.
2. Determine whether any account can have work before requesting market data.
3. Prepare one immutable public market snapshot for the union of required
   symbols. An empty stage performs no market or private exchange requests.
4. Process accounts sequentially in configured order.
5. Reclassify the account's exact eligible symbols from its latest state.
6. Ask the strategy for decisions using the logical time and shared snapshot.
7. Apply actions in this priority:
   - Risk or forced exit.
   - Normal exit.
   - Averaging, only when the position remains open.
   - Entry, only in Capture Entry and only when no position blocks it.
8. Execute through the selected adapter.
9. Apply the shared quantity, fee, PnL, balance, and position calculations.
10. Atomically save state before another action may mutate that position or
    account balance.
11. Record the completed stage result and metrics.

A position closed during a cycle cannot be averaged, exited, or monitored
again in that cycle. At most one balance-changing action is in flight for an
account. Public market work may be shared; balances, positions, orders, and
storage never are.

TC: `BOTH:RUNTIME_EXECUTION_CYCLE`
TC: `BOTH:RUNTIME_EXIT_PRIORITY`
TC: `BOTH:RUNTIME_ACCOUNT_ISOLATION`

# H. Market data and time visibility

Every market request includes the logical time, symbols, interval, and required
lookback. The returned snapshot must state its effective time and may contain
only completed market data visible at that time.

For backtest:

- A candle is visible only when its close time is at or before logical time.
- One-minute and five-minute candles remain independent source series.
- Warmup data is visible to indicators but cannot create trading actions before
  `startTime`.
- vPoints are reconstructed during the run with the copied production
  detection function; future completed vPoints are never preloaded.
- Missing required data, gaps, duplicates, or a future-data response fail the
  run with a clear error.

For live and sandbox, the market adapter keeps the current cache,
single-flight, rate-limit, and freshness behavior. Sharing a market snapshot
does not authorize an order; final private and price guards still run at the
execution boundary.

TC: `BOTH:BACKTEST_CANDLE_VISIBILITY`
TC: `BOTH:RUNTIME_SHARED_MARKET_SNAPSHOT`

# I. Execution behavior by mode

## I.1 Live

The live adapter submits real orders and preserves current idempotency,
exchange reconciliation, uncertain-order recovery, precision, leverage, and
margin-mode behavior.

## I.2 Sandbox

Sandbox runs the same engine and calculations but may only use its sandbox
execution and sandbox storage scope. It must never submit a live order or
write live state.

## I.3 Backtest

The backtest adapter never calls a private exchange endpoint. An accepted
market action fills at the close of the latest visible completed one-minute
candle, with fill time equal to logical time. Optional slippage is deterministic.
V1 has no random latency, partial fills, order book, or random rejection.

All modes return the canonical position shape defined in `DATA_TYPE.md`.
`executionMode` is the only environment field excluded by the V1 Precision
Checker.

TC: `BTEST:BACKTEST_MARKET_FILL`
TC: `BOTH:RUNTIME_MODE_ISOLATION`

# J. Persistence and recovery

Storage scope is at least `mode + account`. Shared public cache data must not be
stored inside one account's state. Commits are atomic from the caller's point
of view.

The engine persists after every successful balance-changing action instead of
waiting for the whole multi-account cycle. This prevents a later failure from
discarding an already executed order.

Failure policy:

- Backtest fails immediately on missing data, invalid state, or execution
  failure. It does not produce a partial success result.
- A production account failure is recorded and does not corrupt or overwrite
  another account's state.
- Failure of required shared market preparation fails that stage for all
  dependent accounts.
- A failed or uncertain live order is not blindly submitted again. Existing
  idempotency and reconciliation decide its outcome.
- The last successful stage statistics are not replaced by a failed pass.

Backtest starts from the supplied `initialState` and writes only to its isolated
run storage. Repeating the same dataset, configuration, strategy, and initial
state must produce the same final state and action log.

TC: `BOTH:RUNTIME_ACTION_COMMIT`
TC: `PROD:RUNTIME_FAILURE_ISOLATION`
TC: `BTEST:BACKTEST_REPRODUCIBLE`

# K. Strategy contract

V1 implements Multi first. The contract must nevertheless keep runtime work
outside the strategy so Hedge and Streak can be added later without copying the
engine.

A strategy plugin may define:

- Its configuration and strategy-owned position state.
- Required public market inputs.
- Entry, exit, and averaging decisions.
- Strategy-specific diagnostics.

A strategy plugin may not:

- Read or write storage directly.
- Read the wall clock directly.
- Submit exchange orders.
- Send notifications or withdrawals.
- Change account or stage ordering.
- Reimplement shared quantity, fee, PnL, or balance accounting.

TC: `BOTH:PLUGIN_STRATEGY`

# L. Metrics and diagnostics

Every run records enough information to explain and compare behavior without
changing decisions:

- Logical time, mode, strategy, stage, account, and symbols.
- Stage duration and section durations.
- Market and private API call counts.
- Cache hits, retries, errors, and rate-limit usage.
- Decisions and ordered action intents.
- Execution results and state-commit counts.
- Skipped stages, accounts, symbols, and their reasons.

Performance duration uses wall-clock measurement. Trading timestamps always use
logical time. Metrics must not include credentials or raw private exchange
payloads in persisted position JSON.

TC: `BOTH:RUNTIME_METRICS`

# M. V1 safety rules

- Backtest and sandbox cannot use the live execution or live storage adapters.
- Backtest cannot initialize notification, withdrawal, or MCP services.
- Runtime configuration and input snapshots are treated as immutable during a
  decision.
- The engine rejects a market snapshot newer than its logical time.
- Account execution remains sequential until shared locking and rate limiting
  prove parallel private mutation safe.
- The engine does not force-close positions at the end of a backtest.

TC: `BOTH:RUNTIME_SAFETY_GUARDS`

# N. Implementation milestones

## N.1 Freeze current behavior

- Add characterization tests for Multi stage selection, action priority,
  accounting, and account ordering.
- Mark shared behavior with the TC codes in this document.
- Reuse current model and configuration types instead of creating parallel
  shapes.

## N.2 Introduce time and scheduling contracts

- Replace decision-path wall-clock reads reached by Precision Backtest with
  `RuntimeClock` input.
- Implement one environment-neutral pure due-stage calculation.
- Add duplicate-stage and deterministic-order tests.

## N.3 Build backtest adapters

- Add dataset-backed clock, market, and execution adapters.
- Add isolated in-memory storage and no-op effects adapters.
- Use fake production-shaped adapters only to prove contract neutrality.
- Add adapter/mode mismatch guards.

## N.4 Extract one shared cycle

- Move stage ownership and the ordered account cycle into
  `src/lib/precision`.
- Keep existing trading calculations in `src/lib/trading`.
- Keep Multi-specific decision behavior in the Multi strategy plugin.
- Do not make the production runner call the engine in this phase.

## N.5 Integrate Precision Backtest first

- Replace the separate dynamic trading loop with the dataset clock, market,
  execution, and isolated storage adapters.
- Reconstruct vPoints only from visible historical candles.
- Make `src/lib/dev/backtestPrecision/api/run.ts` the first application entry
  point that invokes the engine through the isolated runner.
- Remove duplicated backtest decision and accounting paths after parity tests
  pass.

## N.6 Prove backtest precision and safety

- Verify deterministic repeated results.
- Compare canonical final positions with golden Precision Checker fixtures.
- Verify no backtest path can reach live orders or live storage.

## N.7 Future production adoption — not current implementation

- Create production clock, market, execution, storage, and effects adapters.
- Update `src/instrumentation.ts` to bootstrap the shared engine through the
  production runner/facade.
- Replace independent production stage timers with one aligned-minute
  dispatcher.
- Run captured production cases through the Precision Checker.

# O. Completion criteria

The current backtest-first phase is complete when:

- Precision Backtest enters the environment-neutral runtime engine through
  `src/lib/dev/backtestPrecision/api/run.ts`.
- The engine passes with real backtest adapters and fake production-shaped
  adapters, without importing production infrastructure.
- No strategy or trading decision reached by the new engine reads wall-clock
  time directly.
- Due-stage and ordering behavior is covered independently of environment.
- Multi's existing entry, averaging, exit, PnL, fee, balance, vPoint, and risk
  behavior remains covered.
- Public market data is shared while private account state stays isolated and
  sequential.
- Backtest uses only data visible at logical time and reproduces vPoint
  formation timing.
- Repeated backtests are byte-for-byte deterministic after excluding explicitly
  measured wall-clock duration fields.
- Golden cases can be compared using the final-position rules in
  `_PRECISION.md`.
- API calls, durations, errors, retries, rate-limit usage, decisions, actions,
  and commits are measurable.

The full migration is complete later when production live, production sandbox,
and historical backtest all enter the same engine; `src/instrumentation.ts`
boots the production adapters; the same due-stage and ordering tests cover all
modes; and a captured production case can be compared against its backtest
result.

Generic event envelopes, a new persistence architecture, parallel private
account execution, and strategy redesign are not part of V1.
