# Backtest

This document defines the historical-market, simulated-time, and simulated-
execution adapters used by the shared runtime engine.

The shared orchestration and strategy contracts are defined in
`docs/PRECISION/RUNTIME_ENGINE.md`. Canonical market, decision, order,
execution, position, and state types are defined in
`docs/PRECISION/DATA_TYPE.md`.

# A. Purpose

A backtest is the shared runtime engine operating with historical inputs. It is
not a second implementation of the trading strategy.

Backtest, sandbox, and live trading must use the same:

- Strategy plugin
- Runtime scheduling and phase ordering
- Decision and risk logic
- Order-intent creation
- Position, balance, fee, and PnL accounting
- State transitions and evidence schemas

Only the adapters differ:

| Adapter | Backtest behavior |
| --- | --- |
| Market | Reads a versioned historical dataset |
| Clock | Advances logical time without real waiting |
| Execution | Simulates exchange responses from an explicit model |
| Storage | Writes only to an isolated backtest namespace |
| Monitoring | Records run metrics and comparison evidence |

TC: `BTEST:BACKTEST_ADAPTER`

# B. Core guarantees

## B.1 Shared runtime path

The backtest must not have separate entry, averaging, exit, re-entry, or
accounting functions. It supplies events and adapter responses to the same
runtime used in production.

```text
Historical dataset ----> Historical market adapter ---+
                                                        |
Simulated clock --------> Runtime scheduler ------------+--> Shared runtime
                                                        |       and strategy
Execution model --------> Simulated execution adapter --+
```

A strategy decision must not know whether it is running in backtest, sandbox,
or live mode.

TC: `BOTH:SHARED_RUNTIME_ENGINE`

## B.2 No future information

At logical time `t`, the runtime may only see market information whose
`observedT` is less than or equal to `t`. Dataset file order, a candle's final
OHLC values, or knowledge of the next volatility point must never expose future
information.

TC: `BOTH:MARKET_DATA_VISIBILITY`

## B.3 Deterministic simulation

Given the same dataset, effective configuration, initial state, execution-model
version, and seed, repeated backtests must produce the same ordered decisions,
order intentions, simulated executions, and final state.

Any model that uses randomness must use a recorded seed. Unseeded randomness,
wall-clock time, promise-completion order, and filesystem traversal order must
not affect the result.

TC: `BTEST:DETERMINISTIC_SIMULATION`

## B.4 Offline isolation

A backtest must be structurally unable to:

- Submit real exchange orders
- Write production or sandbox state
- Read mutable production state after initialization
- Send production notifications
- Fetch missing market data silently during a run

All required inputs must be prepared before the run starts. If required data is
missing, the run fails with a clear error.

TC: `BTEST:BACKTEST_OFFLINE_ISOLATION`

# C. Backtest composition

The backtest runner composes the normal runtime with backtest adapters. The
following API is illustrative:

```ts
interface BacktestRunOptions<TStrategyConfig> {
  dataset: BacktestDatasetSource;
  config: EffectiveRuntimeConfig<TStrategyConfig>;
  initialState: RuntimeState;
  executionModel: BacktestExecutionModel;
  endPolicy: BacktestEndPolicy;
  /** Seed for every stochastic execution-model decision in this run. */
  seed: string;
}

const backtest = {
  dataset: {
    validate(source: BacktestDatasetSource): Promise<DatasetValidationResult> {
      // Implementation is defined later.
    },
  },
  run(options: BacktestRunOptions<unknown>): Promise<BacktestResult> {
    // Compose and run the shared runtime engine.
  },
};

export default backtest;
```

The public API must remain grouped. Historical loading, clock behavior, and
execution simulation are implementation details behind the adapters.

# D. Historical dataset

## D.1 Dataset requirements

A dataset must contain or reference everything required to construct the
market events visible during the requested period:

- One-minute klines or equivalent price observations
- Five-minute klines or a versioned deterministic rule for deriving them
- Volatility points used by the strategy
- Market context symbols, including BTC when required
- Volume, funding, and other inputs used by the selected strategy or risk flow
- Warmup data required before trading begins
- Observation times for forming-candle snapshots when production can see them
- A schema version, market-data version, source identity, and checksums

The dataset must be immutable for the duration of a run.

TC: `BTEST:BACKTEST_DATASET`

## D.2 Manifest and chunking

Large datasets must be stored in bounded, compact chunks instead of one large
in-memory JSON array. A manifest describes the complete dataset.

```ts
interface BacktestDatasetManifest {
  schema: number;
  id: string;
  createdT: number;
  startT: number;
  endT: number;
  warmupStartT: number;
  source: string;
  exchangeId: string;
  tradingMode: TradingMode;
  symbols: string[];
  intervals: KlineInterval[];
  marketDataVersion: number;
  chunks: EvidenceFileRef[];
}

type BacktestMarketEvent =
  | Omit<RuntimeEvent<"market.kline", MarketKline>, "runId">
  | Omit<
      RuntimeEvent<"market.volatility-point", VolatilityPoint>,
      "runId"
    >
  | Omit<RuntimeEvent<"market.price", MarketPrice>, "runId">
  | Omit<RuntimeEvent<"market.volume-24h", MarketVolume24h>, "runId">
  | Omit<RuntimeEvent<"market.funding", FundingSnapshot>, "runId">;

interface BacktestDatasetChunk {
  symbol: string;
  startT: number;
  endT: number;
  events: BacktestMarketEvent[];
}
```

Chunk boundaries must not create gaps or duplicate logical events. Each event
identifier must be stable after dataset creation. Paths in the manifest must be
safe relative paths, and every checksum must be verified before the run.

The dataset is reusable and therefore does not contain a `runId`. The market
adapter adds the active `runId` when it constructs canonical `MarketEvent`
envelopes; it must preserve the dataset event's `id`, `t`, `seq`, and payload.

The loader should stream or preload only the bounded window required by the
runtime. Performance optimizations must not change event order or visibility.

## D.3 Volatility-point segments

A file such as `SUI_6month.json` may group candles around volatility points for
compact preparation or debugging:

```ts
interface VolatilityPointSegment {
  vPoint: VolatilityPoint;
  /** Events after this point and before the next segment boundary. */
  klines1mAfter: MarketKline[];
  /** Optional when five-minute candles are derived from one-minute inputs. */
  klines5mAfter?: MarketKline[];
}
```

This segment shape is an input-storage format, not the runtime's visibility
rule. The historical market adapter must convert all segments into one ordered
event stream and expose each event only at its `observedT`.

The format must define:

- Whether the boundary candle belongs to the previous or next segment
- The first segment's warmup data
- The last segment's data through `endT`
- How periods with no volatility point are represented
- Duplicate and overlap handling
- Symbol and interval identity for every candle

The runtime must continue to receive scheduled clock work between volatility
points. A long gap between points does not mean that monitoring stops.

TC: `BTEST:VOLATILITY_SEGMENT_IMPORT`

## D.4 One-minute and five-minute candles

The preferred canonical source is an ordered stream of one-minute observations.
Five-minute candles may be derived only when the aggregation rule is versioned
and produces the same candle boundaries and values expected by the runtime.

If production evaluates a forming five-minute candle, the dataset must either:

1. Preserve the exact snapshots and their `observedT`, or
2. Preserve sufficient lower-interval observations to derive those snapshots
   with the same documented aggregation rule.

A final closed five-minute candle alone is insufficient. For example, at 10:03
the backtest must not expose the final close, high, low, or volume of the
10:00-10:05 candle.

Provider corrections and late observations must be stored as later snapshots;
they must not rewrite what was visible at an earlier logical time.

# E. Logical time and scheduling

## E.1 Simulated clock

The simulated clock starts at `warmupStartT` and advances directly to the next
market event, scheduled task, execution response, or requested stop time. It
does not sleep in real time.

Backtest speed changes only wall-clock duration. It must not skip logical
schedule occurrences or combine multiple cycles into different business logic.

```ts
interface SimulatedClockAdapter extends ClockAdapter {
  now(): number;
  advanceToNextEvent(): Promise<number | undefined>;
}
```

No backtest business logic may read `Date.now()`.

TC: `BTEST:SIMULATED_CLOCK`

## E.2 Production-equivalent schedule

The runtime schedules the same configured tasks in every mode, including the
current Risk Sentinel, Speedup, Standard Monitoring, Management, and Capture
Entry stages where applicable.

Task cadence and market-data interval are separate concepts. A task that runs
every minute may inspect a five-minute candle, but it may see only the snapshot
available at that minute.

When market and scheduled events share a logical time, the runtime applies the
priority and sequence rules from `docs/PRECISION/RUNTIME_ENGINE.md`. Those rules
must be configuration-independent and tested.

TC: `BOTH:RUNTIME_SCHEDULING`

## E.3 Event visibility

Before dispatching work at time `t`, the market adapter may publish only events
that became observable according to the runtime's ordering policy. It must not
answer a query by searching ahead in the dataset.

For every returned market value, the adapter must be able to identify the
source event and observation time. A value synthesized from multiple events
must identify the transformation version used.

# F. Initialization and warmup

Every run must start from explicit, immutable inputs:

- Effective runtime and strategy configuration
- Initial account balance and reserved amounts
- Initial open orders and positions, if any
- Initial strategy state, including consumed volatility-point identifiers
- Dataset and execution-model versions
- Backtest start and end times
- Random seed

Warmup observations initialize indicators and market context before `startT`.
They must not trigger trading decisions unless the run explicitly starts with
trading enabled for that time.

Defaults must be resolved before the run and stored with the result. A backtest
must not depend on whichever environment variables or mutable config files are
present when it is later inspected.

If the backtest is compared with a production test case, it must use the same
effective strategy configuration and equivalent starting state. Any deliberate
difference must be declared in the comparison input.

TC: `BTEST:BACKTEST_INITIAL_STATE`

# G. Historical market adapter

The historical market adapter implements the same query and subscription
contract as the live market adapter. It may optimize repeated queries with a
cache, but it must return only information visible at the current logical time.

Its responsibilities include:

- Validating dataset compatibility before runtime startup
- Normalizing and ordering dataset events
- Publishing market events as the simulated clock advances
- Returning as-of-time snapshots for price, candles, volume, funding, and
  volatility points
- Deriving configured intervals through a versioned transformation
- Recording which source events answered each runtime request
- Reporting missing, stale, duplicate, or conflicting data

Missing required data is an error. The adapter must not silently reuse a future
value, invent a zero, or access the network to fill a gap.

If funding, liquidation inputs, volume, or another production input is disabled
for a backtest, that limitation must be explicit in the effective configuration
and result metadata.

TC: `BTEST:HISTORICAL_MARKET_ADAPTER`

# H. Simulated execution adapter

## H.1 Intent boundary

The simulated execution adapter receives the same canonical `OrderIntent` as
the live exchange adapter and returns the same `ExecutionRecord` lifecycle. It
must not recalculate strategy decisions or change an intent silently.

Exchange precision, minimum quantity, minimum notional, available balance,
position mode, and reduce-only constraints must be validated through the same
canonical rules used by live execution where possible.

TC: `BTEST:SIMULATED_EXECUTION_ADAPTER`

## H.2 Versioned execution model

Execution assumptions must be explicit and versioned:

```ts
interface BacktestExecutionModel {
  id: string;
  version: number;
  marketFill: {
    latencyMs: number;
    priceSource: "VISIBLE_PRICE" | "NEXT_1M_OPEN";
  };
  limitFill: {
    enabled: boolean;
    partialFillModelId?: string;
  };
  feeModelId: string;
  slippageModelId?: string;
  rejectionModelId?: string;
}
```

The initial implementation may use a simple deterministic model, but it must
record the model identity with every run. Fees, slippage, latency, partial
fills, rejection, cancellation, liquidation, and funding must not be hidden
constants spread across backtest code.

## H.3 Market orders

A market order may fill only from a market observation visible at or after its
eligible execution time:

```text
eligible execution time = requestT + configured latency
```

When the model uses `VISIBLE_PRICE`, the adapter selects the first eligible
normalized price observation. When it uses `NEXT_1M_OPEN`, it selects the first
one-minute candle opening at or after the eligible time.

The adapter must never fill an order from a volatility-point price merely
because that point triggered the strategy. It may use that price only when it
is also the configured visible execution-price source.

## H.4 Limit and conditional orders

A limit or conditional order may fill only after it becomes active and a later
eligible market observation satisfies the configured crossing rule.

If the dataset cannot determine intrabar price order, the model must apply one
documented conservative rule. It must not choose whichever intrabar sequence
produces the better result. Gap pricing, partial fills, expiry, cancellation,
and simultaneous stop/target eligibility must also follow versioned rules.

## H.5 Fees, slippage, and latency

The adapter records expected price, average fill price, quantity, fees,
request time, acknowledgement time, fill time, slippage, and execution latency
using the canonical execution types.

Slippage is calculated from evidence, not stored as one position-wide setting.
Each entry, averaging, partial fill, and exit may have a different value.

The backtest execution model does not need to match every live fill exactly.
Its difference from the recorded production execution must be measurable by the
Precision Checker.

TC: `BTEST:BACKTEST_EXECUTION_EVIDENCE`

# I. Runtime cycle and strategy behavior

The shared runtime owns cycle ordering. When multiple actions are eligible at
the same logical time, the minimum priority is:

1. Risk and forced-exit work
2. Normal exit
3. Averaging
4. New entry or re-entry

An exited position cannot be averaged in the same cycle. The backtest must not
retain a legacy sequence that averages before checking exit.

Multi, Hedge, and Streak must each execute through their normal strategy plugin
and canonical strategy-specific state. Backtest-specific mutation of shared
volatility-point objects, positions, or strategy configuration is not allowed.

The same stable ordering must be used when several accounts or symbols are due
at the same time. Shared market data may be cached, while balances, positions,
orders, and strategy state remain isolated by account.

TC: `BOTH:RUNTIME_EXECUTION_CYCLE`

# J. End-of-run policy

Reaching `endT` is not an exchange event. The runner must use an explicit end
policy:

```ts
type BacktestEndPolicy =
  | { kind: "KEEP_OPEN" }
  | { kind: "FORCE_CLOSE"; priceModelId: string };
```

`KEEP_OPEN` is required when comparing a backtest with production at the same
cutoff. Open positions are marked using the last visible price and remain open
in final state.

`FORCE_CLOSE` is an optional research/reporting policy. It creates an explicit
synthetic exit event and execution record whose reason identifies the end-of-run
closure. It must not be presented as a normal strategy exit or silently used in
a production-precision comparison.

The runtime must also record whether the run ended normally, was canceled,
failed, or stopped because required data was exhausted.

TC: `BTEST:BACKTEST_END_POLICY`

# K. Result and evidence

A backtest result must include or reference:

- Run identity and completion status
- Dataset manifest identity and checksum
- Effective configuration and its checksum
- Initial and final runtime state
- Ordered market events visible to the runtime
- Strategy decisions, including relevant holds and blocked actions
- Order intentions and simulated execution records
- Position and balance transitions
- Adapter-call measurements and normalized errors
- Execution-model identity and random seed
- End policy
- Summary metrics and time series derived from canonical evidence

```ts
interface BacktestResult {
  schema: number;
  runId: string;
  status: "COMPLETED" | "CANCELED" | "FAILED" | "DATA_EXHAUSTED";
  startT: number;
  endT: number;
  datasetId: string;
  datasetSha256: string;
  configSha256: string;
  executionModel: {
    id: string;
    version: number;
    seed: string;
  };
  endPolicy: BacktestEndPolicy;
  initialState: EvidenceFileRef;
  evidence: {
    market: EvidenceFileRef[];
    decisions: EvidenceFileRef[];
    intents: EvidenceFileRef[];
    executions: EvidenceFileRef[];
    positions: EvidenceFileRef[];
    adapterCalls: EvidenceFileRef[];
  };
  finalState: EvidenceFileRef;
  summary: BacktestSummary;
}
```

`BacktestSummary` may contain trade count, open-position count, gross and net
PnL, fees, drawdown, growth, win rate, liquidation count, and exposure. These
are derived values. Canonical evidence remains the source of truth.

Large event streams must use compact bounded files. Pretty-printed JSON is not
required for machine-owned evidence.

TC: `BTEST:BACKTEST_RESULT`

# L. Production precision comparison

A production test case and a backtest are separate runs. The backtest does not
use recorded production exchange responses as its execution source. Instead,
it uses the historical market dataset and simulated execution for the same
period, strategy, configuration, and equivalent starting state.

The Precision Checker aligns their evidence and compares:

- Normalized inputs and logical observation times
- Strategy decisions
- Order intentions
- Simulated execution against recorded production execution
- Position, balance, fee, and PnL results

Identical inputs must produce identical decisions and order intentions.
Execution and financial results may differ, but every difference must be
measurable and explainable.

The checker contract, matching rules, tolerances, and scores belong in
`docs/PRECISION/PRECISION_CHECKER.md`.

# M. Cancellation and failure

Cancellation is cooperative. The runner checks an abort signal between event
dispatches and after adapter operations. It must finish or safely reject the
current atomic state transition before stopping.

A canceled or failed run preserves enough evidence to diagnose the last
completed logical event. It must never be labeled completed and must not be used
as a precision baseline without an explicit override.

Dataset-validation errors, unsupported schemas, checksum mismatches, missing
market inputs, impossible timestamps, and simulation-model failures must use
stable machine-readable error codes.

# N. Validation requirements

At minimum, automated tests must prove:

- Backtest composes the shared runtime instead of a separate trading loop.
- Repeated runs with identical inputs produce identical evidence and state.
- No event is visible before its `observedT`.
- Forming five-minute candles do not expose their final values early.
- Runtime tasks execute at production-equivalent logical cadences.
- Same-time work follows risk, exit, averaging, then entry priority.
- Market and limit fills never use future candle data.
- Fees, slippage, latency, partial fills, rejection, and cancellation are
  recorded according to the selected model.
- Long and short accounting use the same canonical execution evidence.
- Multi-account and multi-symbol ordering is stable.
- Multi, Hedge, and Streak strategy state remains isolated and compatible.
- `KEEP_OPEN` preserves open positions at `endT`.
- `FORCE_CLOSE` produces an explicit synthetic execution.
- Backtest cannot call a live execution adapter or write live storage.
- Missing required historical data fails instead of being silently substituted.
- Large datasets can be processed in bounded memory without changing results.

# O. Migration from the current volatility backtest

The current implementation should be migrated in stages:

1. Freeze representative current results for regression visibility.
2. Convert existing volatility datasets into the versioned dataset manifest and
   canonical market-event schema.
3. Add historical market, simulated clock, simulated execution, isolated
   storage, and monitoring adapters.
4. Run the existing strategy through the shared runtime scheduler.
5. Replace the volatility-point-only loop with scheduled logical-time events.
6. Remove duplicated backtest entry, averaging, exit, and accounting logic.
7. Replace implicit volatility-point fills and global fee constants with the
   versioned execution model.
8. Replace averaging-before-exit behavior with the shared runtime priority.
9. Make end-of-run closure an explicit policy instead of an automatic final
   sale.
10. Compare the migrated result with production test cases through the
    Precision Checker.

Temporary compatibility adapters are acceptable during migration, but they
must not become a permanent second runtime path.

# P. Related documents

- `docs/PRECISION/_PRECISION.md`
- `docs/PRECISION/RUNTIME_ENGINE.md`
- `docs/PRECISION/DATA_TYPE.md`
- `docs/PRECISION/PRECISION_CHECKER.md`
- `docs/PRECISION/PAGES.md`
- `docs/PRECISION/FOLDER.md`
