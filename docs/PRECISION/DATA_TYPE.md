# Canonical Data Types

This document defines the data boundaries required by
`docs/PRECISION/RUNTIME_ENGINE.md`. These types are the contract shared by
backtest, sandbox, live trading, strategy plugins, persistence, monitoring, and
the Precision Checker.

The examples are the intended TypeScript shapes. Names may be refined during
implementation, but their ownership, units, evidence, and compatibility rules
are requirements.

# A. Design principles

## A.1 One canonical domain model

Backtest, sandbox, and live trading must use the same market-event, decision,
order-intent, execution, position, balance, and strategy-state types.

Mode-specific provider responses must be normalized at adapter boundaries. Core
runtime and strategy code must not receive Binance, OKX, Tokocrypto, or
historical-dataset response shapes directly.

TC: `BOTH:CANONICAL_RUNTIME_TYPES`

## A.2 Common core with strategy-specific state

The position model must not become one large object containing unrelated
optional fields for every strategy.

Every position has:

- Common identity, lifecycle, exposure, execution, fee, funding, and PnL fields
- A discriminated strategy envelope
- Strategy-specific state selected by the strategy identifier

This makes invalid combinations harder to create. For example, a Multi position
does not need Streak re-entry fields, while a Streak position can require a pair
identifier and role.

TC: `BOTH:STRATEGY_POSITION_STATE`

## A.3 Evidence before derived values

Persist the evidence needed to reproduce a calculation. For example, expected
price and actual average fill price are authoritative evidence for slippage.
`slippagePct` may also be stored as a calculation snapshot, but it must not be
the only evidence retained.

Raw provider requests and responses belong in a separate execution audit. The
position stores normalized execution summaries and fill evidence only.

## A.4 Compact, explicit persistence

- Persist compact JSON unless a file is explicitly intended for people to edit.
- Use `t` for a general timestamp and short qualified names such as `openT`,
  `requestT`, `ackT`, and `fillT` when several times exist together.
- Use `pct` for percent values.
- Include the unit in money fields, such as `marginUsdt` and `feeUsdt`.
- Do not persist duplicate human-readable dates; format timestamps in the UI.
- Do not use `undefined` as a meaningful persisted value. Optional fields are
  omitted.
- Do not persist `NaN`, `Infinity`, functions, class instances, or provider SDK
  objects.

# B. Existing-model inventory

The migration starts from these verified differences:

| Area | Multi | Hedge | Streak |
| --- | --- | --- | --- |
| Position direction | One position direction | MAIN and COUNTER legs | MAIN and COUNTER legs |
| Pair identity | Not required | Pair relationship is required | Stable pair identity retained across re-entry |
| Entry selection | Existing Multi configuration | `MAIN`, `COUNTER`, or `BOTH` | `MAIN`, `COUNTER`, or `BOTH` |
| Entry range | Minimum actionable absolute level | Minimum and maximum entry level | Minimum and maximum entry level |
| Re-entry state | Not required | Not currently required | Pending role re-entry is required |
| vPoint consumption | Account-aware entry usage | Leg-aware behavior | Per-role entry usage |
| Shared accounting | Exposure, fees, averaging, PnL, funding, monitoring, open/close events | Same | Same |

The new model therefore uses one shared position and separate strategy-state
types. Existing mutable fields such as `used`, `usedByMain`, and
`usedByCounter` must not remain transient properties on shared market-data
objects. Their durable meaning belongs in account-owned strategy state.

# C. Shared primitives and conventions

```ts
type RuntimeMode = "backtest" | "sandbox" | "live";
type StrategyId = "multi" | "hedge" | "streak" | (string & {});
type TradingMode = "spot" | "margin_cross" | "margin_isolated" | "futures";
type PositionDirection = "LONG" | "SHORT";
type PositionRole = "MAIN" | "COUNTER";
type EntryLegs = "MAIN" | "COUNTER" | "BOTH";
type OrderSide = "BUY" | "SELL";
type OrderType =
  | "MARKET"
  | "LIMIT"
  | "STOP_LIMIT"
  | "STOP_MARKET"
  | "TAKE_PROFIT_LIMIT"
  | "TAKE_PROFIT_MARKET";
type KlineInterval =
  | "1m"
  | "3m"
  | "5m"
  | "15m"
  | "30m"
  | "1h"
  | "2h"
  | "4h"
  | "6h"
  | "8h"
  | "12h"
  | "1d"
  | "3d"
  | "1w"
  | "1M";
```

Rules:

- All timestamps are Unix milliseconds in UTC.
- Percent fields use percentage points: `1.5` means `1.5%`, not `0.015`.
- Funding rate is an exception and remains a decimal rate: `0.0001` means
  `0.01%`.
- Prices, quantities, and money must be finite and non-negative unless the field
  explicitly represents signed PnL.
- Exchange precision and rounding are applied through one canonical numeric
  utility before an order is submitted or simulated.
- Identifiers are opaque strings. Business logic must not parse meaning from an
  identifier.

# D. Versioned runtime identity

Every run and persisted root must identify the code and schema that created it.

```ts
interface RuntimeVersions {
  schema: number;
  runtime: number;
  strategy: number;
  marketData: number;
  executionModel: number;
}

interface RuntimeIdentity {
  runId: string;
  mode: RuntimeMode;
  strategyId: StrategyId;
  accountId: string;
  versions: RuntimeVersions;
}
```

- `runId` identifies one start-to-stop runtime execution or one backtest run.
- `accountId` is the immutable internal account identity. A display name is not
  an identity.
- A production test case records this complete identity.

TC: `BOTH:RUNTIME_IDENTITY`

# E. Runtime events

## E.1 Event envelope

All data and lifecycle changes pass through one ordered event envelope.

```ts
interface RuntimeEvent<TType extends string, TPayload> {
  id: string;
  runId: string;
  type: TType;
  /** Logical event time. */
  t: number;
  /** Deterministic tie-breaker for events with the same logical time. */
  seq: number;
  payload: TPayload;
}
```

Event identifiers and sequence numbers are assigned once. Retrying or
redispatching the same event must not create a second logical event.

## E.2 Normalized kline

The existing provider tuple must be converted into an object before entering
the runtime.

```ts
interface MarketKline {
  symbol: string;
  interval: KlineInterval;
  openT: number;
  closeT: number;
  /** Time this exact candle snapshot became visible to the runtime. */
  observedT: number;
  closed: boolean;
  open: number;
  high: number;
  low: number;
  close: number;
  baseVolume: number;
  quoteVolume: number;
  tradeCount?: number;
}
```

`observedT` and `closed` are required for input-precision checks. Two snapshots
of the same forming candle may share `openT` and `closeT` but have different
`observedT`, prices, volumes, and event identifiers.

TC: `BOTH:MARKET_KLINE_EVENT`

## E.3 Volatility point

```ts
interface VolatilityPoint {
  id: string;
  t: number;
  label: "TOP" | "BOTTOM";
  pct: number;
  price: number;
  baseVolume: number;
  quoteVolume: number;
  level: number;
}
```

The canonical market-data point contains only market evidence. Entry usage,
features, probability, recommendation labels, and temporary debugging messages
belong in strategy or decision state.

```ts
interface MarketPrice {
  symbol: string;
  price: number;
  source: string;
  eventT: number;
  observedT: number;
}

interface MarketVolume24h {
  symbol: string;
  quoteVolume: number;
  source: string;
  eventT: number;
  observedT: number;
}
```

## E.4 Market event union

```ts
type MarketEvent =
  | RuntimeEvent<"market.kline", MarketKline>
  | RuntimeEvent<"market.volatility-point", VolatilityPoint>
  | RuntimeEvent<"market.price", MarketPrice>
  | RuntimeEvent<"market.volume-24h", MarketVolume24h>
  | RuntimeEvent<"market.funding", FundingSnapshot>;
```

`MarketPrice`, `MarketVolume24h`, and `FundingSnapshot` must contain symbol,
source, value, source event time, and observation time. Their exact provider
fields remain inside the market adapter audit.

TC: `BOTH:MARKET_EVENT_SCHEMA`

# F. Effective configuration

Every run uses one fully resolved configuration snapshot. Defaults and
environment values are resolved before the engine starts.

```ts
type RuntimeTaskId =
  | "risk-sentinel"
  | "speedup"
  | "standard-monitoring"
  | "management"
  | "capture-entry"
  | (string & {});

interface RuntimeSchedulingConfig {
  tasks: Array<{
    id: RuntimeTaskId;
    enabled: boolean;
    intervalMs: number;
    priority: number;
  }>;
}

interface RuntimeRiskConfig {
  autoEntryEnabled: boolean;
  autoExitEnabled: boolean;
  dailyPnlLimitUsdt: number;
}

interface RuntimeExecutionConfig {
  defaultOrderType: OrderType;
  feeModelId: string;
  slippageModelId?: string;
}

interface EffectiveRuntimeConfig<TStrategyConfig> {
  identity: RuntimeIdentity;
  exchange: {
    id: string;
    tradingMode: TradingMode;
    futuresPositionMode?: "ONE_WAY" | "HEDGE";
  };
  symbols: string[];
  scheduling: RuntimeSchedulingConfig;
  risk: RuntimeRiskConfig;
  execution: RuntimeExecutionConfig;
  strategy: {
    id: StrategyId;
    version: number;
    config: TStrategyConfig;
  };
}
```

Strategy configuration is discriminated by `strategy.id`:

```ts
type StrategyConfig =
  | { id: "multi"; config: MultiStrategyConfig }
  | { id: "hedge"; config: HedgeStrategyConfig }
  | { id: "streak"; config: StreakStrategyConfig };
```

Shared runtime controls such as cadence, API coordination, persistence, and
global risk do not belong inside individual strategy configuration. Strategy
rules such as entry levels, leg selection, re-entry, averaging, and exit policy
do not belong in the generic runtime configuration.

The snapshot stored with a result must contain effective values rather than
references to mutable configuration files.

TC: `BOTH:EFFECTIVE_CONFIG_SNAPSHOT`

# G. Strategy state and decisions

## G.1 Strategy state envelope

```ts
interface StrategyState<TId extends StrategyId, TData> {
  id: TId;
  version: number;
  data: TData;
}

type AccountStrategyState =
  | StrategyState<"multi", MultiAccountStrategyState>
  | StrategyState<"hedge", HedgeAccountStrategyState>
  | StrategyState<"streak", StreakAccountStrategyState>;
```

Account strategy state owns consumed entry signals or vPoints. It must not be
stored by mutating shared public market objects.

```ts
interface EntryConsumptionState {
  /** Keyed by stable vPoint id. */
  byVPointId: Record<string, true>;
}

interface RoleEntryConsumptionState {
  MAIN: EntryConsumptionState;
  COUNTER: EntryConsumptionState;
}

interface MultiAccountStrategyState {
  entryConsumption: EntryConsumptionState;
}

interface HedgeAccountStrategyState {
  entryConsumption: RoleEntryConsumptionState;
}

interface StreakAccountStrategyState {
  pendingReentries: StreakPendingReentry[];
  entryConsumption: RoleEntryConsumptionState;
}
```

The detailed state of each strategy is finalized during that strategy's
migration. Unknown strategy fields remain inside its versioned `data` object,
not on the common account or position root.

## G.2 Strategy decision

A decision records what the strategy concluded before risk and execution.

```ts
type StrategyDecisionAction =
  | "HOLD"
  | "ENTER"
  | "AVERAGE"
  | "EXIT"
  | "REENTER";

interface StrategyDecision<TData = unknown> {
  id: string;
  runId: string;
  eventId: string;
  accountId: string;
  strategyId: StrategyId;
  strategyVersion: number;
  t: number;
  action: StrategyDecisionAction;
  symbol: string;
  positionId?: string;
  role?: PositionRole;
  direction?: PositionDirection;
  reasonCode: string;
  message: string;
  data?: TData;
}
```

`reasonCode` is stable and machine-comparable. `message` is explanatory and
must not be used by business logic or the Precision Checker for equality.

HOLD and blocked decisions are retained when they are needed to explain why a
production and backtest run first diverged.

TC: `BOTH:STRATEGY_DECISION_SCHEMA`

# H. Order intent and execution

## H.1 Order intent

An order intent is an approved request produced after strategy and centralized
risk evaluation but before exchange-specific translation.

```ts
type PositionExecutionKind = "ENTRY" | "AVERAGE" | "EXIT";

interface OrderIntent {
  id: string;
  runId: string;
  decisionId: string;
  accountId: string;
  positionId: string;
  strategyId: StrategyId;
  t: number;
  kind: PositionExecutionKind;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  direction: PositionDirection;
  role?: PositionRole;
  expectedPrice: number;
  quantity?: number;
  quoteUsdt?: number;
  limitPrice?: number;
  stopPrice?: number;
  reduceOnly?: boolean;
  clientOrderId: string;
  reasonCode: string;
}
```

The same intent type is passed to simulated and live execution adapters.
`clientOrderId` must remain stable across retries.

TC: `BOTH:ORDER_INTENT_SCHEMA`

## H.2 Execution status and fills

```ts
type ExecutionStatus =
  | "CREATED"
  | "SUBMITTING"
  | "ACKNOWLEDGED"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "REJECTED"
  | "CANCEL_PENDING"
  | "CANCELED"
  | "EXPIRED"
  | "UNKNOWN";

interface ExecutionFill {
  id: string;
  t: number;
  price: number;
  quantity: number;
  feeUsdt: number;
}

interface ExecutionRecord {
  id: string;
  runId: string;
  intentId: string;
  accountId: string;
  positionId: string;
  kind: PositionExecutionKind;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  status: ExecutionStatus;
  clientOrderId: string;
  exchangeOrderId?: string;
  expectedPrice: number;
  requestedQuantity?: number;
  requestedQuoteUsdt?: number;
  filledQuantity: number;
  averageFillPrice?: number;
  feeUsdt: number;
  requestT: number;
  ackT?: number;
  fillT?: number;
  fills?: ExecutionFill[];
  slippagePct?: number;
  executionLatencyMs?: number;
  errorCode?: string;
}

type PositionExecution = Omit<
  ExecutionRecord,
  "runId" | "accountId" | "positionId" | "symbol"
>;
```

The normalized `fills` array is not a raw exchange response. It provides the
evidence for partial-fill accounting. `averageFillPrice`, `feeUsdt`,
`slippagePct`, and `executionLatencyMs` are summaries that must agree with the
underlying evidence.

For a buy:

```text
slippagePct = (averageFillPrice - expectedPrice) / expectedPrice * 100
```

For a sell, the sign is reversed so positive slippage always means execution
was worse than expected:

```text
slippagePct = (expectedPrice - averageFillPrice) / expectedPrice * 100
```

The exact rounding policy is defined once in the execution module and used by
both simulated and live result normalization.

TC: `BOTH:EXECUTION_RECORD_SCHEMA`

# I. Canonical position

## I.1 Shared position shape

```ts
type PositionStatus = "OPENING" | "OPEN" | "CLOSING" | "CLOSED";

interface Position<
  TStrategyId extends StrategyId,
  TStrategyData = unknown,
> {
  schema: number;
  id: string;
  accountId: string;
  symbol: string;
  mode: RuntimeMode;
  tradingMode: TradingMode;
  direction: PositionDirection;
  status: PositionStatus;
  revision: number;

  opened: PositionOpen;
  executions: PositionExecution[];
  exposure: PositionExposure;
  fees: PositionFees;
  pnl: PositionPnl;
  funding?: FundingSnapshot;
  monitoring?: PositionMonitoringState;
  control?: PositionControl;
  strategy: PositionStrategyState<TStrategyId, TStrategyData>;
  closed?: PositionClose;
  notes?: string;
}
```

`id` is stable for the full lifecycle of one position. A Streak re-entry creates
a new position id but keeps the strategy's stable pair id.

`revision` increments after every persisted state change and supports optimistic
consistency checks. `status` is authoritative; `closed` contains the close
summary and is required when status is `CLOSED`.

TC: `BOTH:POSITION_SCHEMA`

## I.2 Open and close summaries

```ts
interface VPointRef {
  id: string;
  t: number;
  level: number;
  price: number;
}

interface PositionOpen {
  t: number;
  decisionId: string;
  intentId: string;
  executionId: string;
  reasonCode: string;
  source: "AUTOMATIC" | "MANUAL" | "BYPASS";
  vPoint?: VPointRef;
}

interface PositionClose {
  t: number;
  decisionId?: string;
  intentId?: string;
  executionId?: string;
  reasonCode: PositionCloseReason;
  source: "AUTOMATIC" | "MANUAL" | "EXCHANGE" | "RISK";
  vPoint?: VPointRef;
  message: string;
}

type PositionCloseReason =
  | "TAKE_PROFIT"
  | "STOP_LOSS"
  | "EXIT_ON_VPOINT_LEVEL"
  | "STOP_LOSS_BY_USDT_LOSS"
  | "LEVEL_BASED_PCT_DRIFT_STOP_LOSS"
  | "STOP_LOSS_PLUS_TP"
  | "VOLATILITY_TARGET_TP"
  | "VOLATILITY_TARGET_SL"
  | "VOLATILITY_TARGET_EXIT"
  | "POST_AVERAGE_RESCUE_EXIT"
  | "POST_AVERAGE_STOP_LOSS"
  | "POST_AVERAGE_RESCUE_TP"
  | "FINAL"
  | "LIQUIDATED"
  | "MANUAL"
  | "FORCED"
  | "UNKNOWN";
```

Opening and closing prices, quantities, and fees come from their referenced
execution records. The summaries must not contain a conflicting second copy.

## I.3 Exposure and fees

```ts
interface PositionExposure {
  quantity: number;
  averageEntryPrice: number;
  notionalUsdt: number;
  marginUsdt: number;
  leverage: number;
}

interface PositionFees {
  entryUsdt: number;
  averagingUsdt: number;
  exitUsdt: number;
  fundingUsdt: number;
  totalUsdt: number;
  estimatedExitUsdt?: number;
}
```

Exposure and fees are persisted snapshots derived from normalized fills. The
runtime validates them after every execution.

## I.4 PnL

```ts
interface PositionPnlPoint {
  t: number;
  pct: number;
  usdt: number;
  markPrice: number;
}

interface PositionPnl {
  markPrice?: number;
  netPct?: number;
  netUsdt?: number;
  currentValueUsdt?: number;
  maxUpPct?: number;
  maxDownPct?: number;
  maxUpUsdt?: number;
  maxDownUsdt?: number;
  history?: PositionPnlPoint[];
}
```

PnL must be fee-aware and direction-aware. A history bucket records or replaces
the latest observation according to runtime configuration; the bucket interval
does not change monitoring cadence.

## I.5 Funding and monitoring

```ts
interface FundingSnapshot {
  exchange: string;
  rate: number;
  t: number;
  observedT: number;
  nextT?: number;
}

interface PositionMonitoringState {
  stage: "speedup" | "standard";
  t: number;
  reasonCode: string;
  message: string;
}
```

Monitoring state is the last successful monitoring classification. Failed work
must not replace it.

## I.6 Averaging state

```ts
type ReserveStepStatus = "RESERVED" | "UNRESERVED" | "USED" | "RELEASED";

interface ReserveStep {
  level: number;
  marginUsdt: number;
  allocationPct: number;
  status: ReserveStepStatus;
  reservedMarginUsdt?: number;
  usedT?: number;
  usedPrice?: number;
  releasedT?: number;
}

interface AveragingState {
  entryLevel: number;
  lastHandledLevel: number;
  reserveBaseMarginUsdt: number;
  reservedRemainingMarginUsdt: number;
  steps: ReserveStep[];
}
```

Completed averaging orders are represented by `position.executions` with kind
`AVERAGE`. They must not be duplicated in a second averaging-execution array.

# J. Strategy-specific position data

```ts
interface PositionStrategyState<
  TId extends StrategyId,
  TData,
> {
  id: TId;
  version: number;
  entry: {
    engine?: string;
    label?: string;
    feature?: unknown;
  };
  averaging: AveragingState;
  data: TData;
}

interface MultiPositionData {
  kind: "multi";
}

interface HedgePositionData {
  kind: "hedge";
  pairId: string;
  role: PositionRole;
  entryLegs: EntryLegs;
}

interface StreakPositionData {
  kind: "streak";
  pairId: string;
  role: PositionRole;
  entryLegs: EntryLegs;
  generation: number;
}

type CanonicalPosition =
  | Position<"multi", MultiPositionData>
  | Position<"hedge", HedgePositionData>
  | Position<"streak", StreakPositionData>;
```

`pairId` is stable across the related Hedge legs and across Streak re-entries.
`generation` starts at zero for the original Streak leg and increments when that
role is successfully reopened.

Strategy-specific close reasons remain stable machine codes. The initial union
must include all currently persisted reasons, including legacy deprecated
values, so history stays readable. New close reasons are added explicitly and
must not be inferred from free-form messages.

TC: `BOTH:POSITION_STRATEGY_DISCRIMINATOR`

## J.1 Pending Streak re-entry

Pending re-entry belongs to account strategy state, not to a closed position or
shared market object.

```ts
interface StreakPendingReentry {
  id: string;
  pairId: string;
  role: PositionRole;
  direction: PositionDirection;
  previousPositionId: string;
  anchor: VPointRef;
  closeReason: PositionCloseReason;
  createdT: number;
}

```

The pending item is removed only after the replacement entry succeeds or a
documented terminal rule cancels it.

# K. Account and runtime state

```ts
interface BalanceState {
  startingUsdt: number;
  availableUsdt: number;
  reservedUsdt: number;
  spendableUsdt: number;
  lockedUsdt: number;
  safeHavenUsdt: number;
}

interface PendingIntent {
  intent: OrderIntent;
  status: "PERSISTED" | "UNCERTAIN";
  lastAttemptT?: number;
}

interface RuntimeState<
  TStrategyId extends StrategyId,
  TAccountStrategyState,
> {
  schema: number;
  identity: RuntimeIdentity;
  revision: number;
  updatedT: number;
  balance: BalanceState;
  positions: CanonicalPosition[];
  pendingIntents: PendingIntent[];
  strategy: StrategyState<TStrategyId, TAccountStrategyState>;
  risk: RuntimeRiskState;
  scheduler: RuntimeSchedulerState;
}
```

Closed history may be stored separately from active state for efficiency, but
it must use the same canonical position schema. Public market caches must not be
embedded in every account state.

Each runtime mode has an isolated state namespace. A live state cannot be
loaded as a backtest or sandbox state without an explicit read-only conversion.

TC: `BOTH:RUNTIME_STATE_SCHEMA`

# L. Monitoring and comparison evidence

## L.1 Adapter-call measurement

```ts
interface AdapterCallMeasurement {
  id: string;
  runId: string;
  adapter: "market" | "clock" | "execution" | "storage" | "monitoring";
  operation: string;
  startT: number;
  endT: number;
  durationMs: number;
  status: "SUCCESS" | "FAILED" | "SKIPPED";
  attempt: number;
  cacheHit?: boolean;
  rateLimit?: {
    limit?: number;
    remaining?: number;
    resetT?: number;
    retryAfterMs?: number;
  };
  errorCode?: string;
}
```

Monitoring records metadata, counts, durations, and normalized errors. Secrets,
credentials, and complete raw responses must not enter normal monitoring data.

TC: `BOTH:ADAPTER_CALL_MEASUREMENT`

## L.2 Production test-case manifest

A production test case must contain or reference enough canonical evidence for
the Precision Checker. Trade history alone is not sufficient to evaluate input,
decision, or execution precision.

```ts
interface EvidenceFileRef {
  path: string;
  sha256: string;
  count: number;
  bytes: number;
}

interface ProductionTestCaseManifest {
  schema: number;
  id: string;
  createdT: number;
  startT: number;
  endT: number;
  identity: RuntimeIdentity;
  config: EffectiveRuntimeConfig<unknown>;
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
}
```

Large evidence streams must be stored in compact, bounded files referenced by
the manifest. Checksums detect accidental modification and allow the checker to
prove which exact evidence it compared.

`path` must be a safe relative path within the test-case directory. It must not
contain credentials or depend on an absolute path from the machine that created
the case.

The detailed capture lifecycle belongs in
`docs/PRECISION/PRECISION_CHECKER.md`.

TC: `PROD:PRODUCTION_TEST_CASE_MANIFEST`

# M. Persistence and compatibility

## M.1 Schema version

Every persisted root contains a numeric `schema`. Readers must:

1. Validate the parsed JSON as untrusted input.
2. Detect its schema version.
3. Migrate older supported versions sequentially.
4. Validate the migrated canonical value.
5. Reject unsupported future versions without overwriting the file.

Writers only emit the latest schema. Migrations must be deterministic and
covered by fixtures from all three existing repositories.

TC: `BOTH:PERSISTED_SCHEMA_VERSION`

## M.2 Legacy position migration

The migration must preserve existing position and history meaning:

- Existing account, symbol, execution mode, trading mode, direction, open,
  exposure, fees, averaging, PnL, funding, monitoring, control, and close fields
  map into the canonical common position.
- Multi positions receive `strategy.data.kind = "multi"`.
- Hedge `role`, `entryLegs`, and derived pair identity move into
  `strategy.data`.
- Streak `role`, `entryLegs`, and `pairId` move into `strategy.data`.
- Streak `pendingReentries` move from model memory into account strategy state.
- vPoint `used`, `usedByMain`, `usedByCounter`, and dynamic
  `usedBy<accountSlug>` properties migrate into account strategy consumption
  state.
- Existing averaging execution records become canonical execution evidence when
  enough source information exists.
- Missing historical order identifiers, timings, or prices are marked as legacy
  evidence gaps. Migration must not invent values.
- Deprecated close reasons remain readable.

Legacy history without complete execution evidence can participate in result
comparison, but the Precision Checker must report unavailable execution metrics
instead of treating them as zero.

TC: `BOTH:LEGACY_POSITION_MIGRATION`

## M.3 Storage safety

- State checkpoints must be atomic.
- Balance-changing writes use revision checks or equivalent serialization.
- A failed write must leave the last valid checkpoint readable.
- Large append-only evidence is finalized before its manifest references it.
- Live, sandbox, backtest, and production-test-case files use separate roots.
- Normal JSON output is compact.

# N. Required invariants

The implementation and tests must enforce these invariants:

- A position belongs to exactly one account, runtime mode, and strategy.
- An open position has no close summary; a closed position has one.
- Filled quantity equals the sum of normalized fills when fill details exist.
- Average fill price and fees agree with normalized fills.
- Exposure agrees with all applied entry and averaging fills minus exits.
- Position execution records reference stable decisions and order intentions.
- An execution event is applied at most once.
- A client order id is stable across retries of the same intention.
- Position and balance revisions increase monotonically.
- MAIN and COUNTER positions in one pair have different directions.
- Streak re-entry retains pair identity and creates a new position identity.
- Market events never contain account-owned entry-consumption state.
- Strategy messages are diagnostic; stable codes drive logic and comparison.
- Backtest and sandbox state cannot be mistaken for live state.
- Missing legacy evidence is represented as unavailable, never as a fabricated
  zero.

TC: `BOTH:CANONICAL_DATA_INVARIANTS`

# O. Public module shape

The implementation should expose one grouped data-model API with explicit type
exports, rather than broad barrel exports of internal modules.

```ts
const tradingData = {
  runtime: {
    parseState,
    parseConfig,
  },
  market: {
    parseEvent,
  },
  position: {
    parse,
    migrate,
    validate,
  },
  execution: {
    parseIntent,
    parseRecord,
  },
};

export default tradingData;
export type {
  CanonicalPosition,
  EffectiveRuntimeConfig,
  ExecutionRecord,
  MarketEvent,
  OrderIntent,
  RuntimeEvent,
  RuntimeState,
  StrategyDecision,
};
```

The actual implementation must reuse existing validated types and calculations
where they already satisfy this contract. It must not perform a broad rewrite
only to rename fields.

# P. Related documents

- `docs/PRECISION/_PRECISION.md`: project goals and meaning of precision
- `docs/PRECISION/RUNTIME_ENGINE.md`: ownership and runtime flow
- `docs/PRECISION/BACKTEST.md`: historical data and simulated execution
- `docs/PRECISION/PRECISION_CHECKER.md`: evidence capture and scoring
- `docs/PRECISION/FOLDER.md`: module ownership and public boundaries
