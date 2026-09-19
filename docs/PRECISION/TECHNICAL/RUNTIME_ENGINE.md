# Runtime Engine V1 — Technical Implementation Plan

Audience: coding agents implementing the Precision Runtime Engine, especially
GPT-5.6 Luna with maximum reasoning.

This document is subordinate to:

1. `docs/PRECISION/_PRECISION.md`
2. `docs/PRECISION/HIGH_LEVEL/RUNTIME_ENGINE.md`
3. `docs/PRECISION/HIGH_LEVEL/BACKTEST.md`
4. `docs/PRECISION/HIGH_LEVEL/DATA_TYPE.md`
5. `docs/SPECS/_SPECS.md` and its linked behavior specifications

If this document conflicts with `_PRECISION.md`, `_PRECISION.md` wins. Do not
silently choose a different design. Correct the technical plan first.

## Current implementation boundary: backtest first

The first and only runtime integration target in this implementation phase is:

```text
src/lib/dev/backtestPrecision/api/run.ts
  -> isolated backtest child process
  -> src/lib/backtest/runner
  -> src/lib/precision/runtime
```

Do not wire the new engine into production in this phase. In particular, do
not change these production bootstrap/orchestration owners as part of the
backtest implementation:

```text
src/instrumentation.ts
src/lib/slowTrading/runner.ts
src/lib/slowTrading/singleton.ts
src/lib/slowTrading/cycle/**
src/lib/slowTrading/management.ts
src/lib/slowTrading/black-swan.ts
```

The existing production/live/sandbox runner remains authoritative and
untouched. The new runtime engine must still be environment-neutral: it takes
clock, market, execution, storage, strategy, effects, metrics, and logging as
injected contracts. A later production phase can therefore construct
production adapters in `src/instrumentation.ts` and call the same engine API
without redesigning the engine or the Multi strategy plugin.

This distinction is mandatory:

- **Now:** implement and prove the engine through Precision Backtest.
- **Later:** replace the production bootstrap and stage timers with production
  adapters calling that already-proven engine.
- **Not acceptable now:** editing production orchestration merely to claim
  that live and backtest already share a caller.

# 1. Agent execution rules

The implementing agent must follow these rules:

- Implement one milestone from Section 22 at a time.
- Run `npm run type` and `npm run quality` after every milestone.
- Do not delete or reroute the existing production path in this phase.
- Do not edit `src/instrumentation.ts` in this phase.
- Do not delete the legacy backtest path while Quick Backtest or another page
  still imports it.
- Do not redesign Multi strategy rules, vPoint detection, entry sizing,
  averaging, exit decisions, fee calculations, or PnL calculations.
- Reuse current types and pure helpers before introducing new ones.
- Do not add a generic event bus, dependency-injection framework, repository
  framework, or broad persistence abstraction.
- Use grouped public APIs. Do not create new broad `export *` barrels.
- Do not add backward-compatibility branches for the current pre-launch runtime
  storage. Update checked-in JSON fixtures and tests when the canonical shape
  changes.
- Dataset and backtest-result readers must still validate their explicit schema
  number. Invalid data must fail clearly.
- Keep all credentials, notification secrets, and live-storage paths outside a
  backtest child process.
- Add the TC comment beside both the implementation and test for behavior
  introduced by this plan.
- Preserve unrelated user changes in the working tree.

# 2. Definition of completion

## 2.1 Backtest-first phase completion

The current implementation phase is complete only when:

- `src/lib/dev/backtestPrecision/api/run.ts` launches the isolated Precision
  Backtest path and receives real engine results.
- Precision Backtest calls `src/lib/precision/runtime`; it does not call a
  second backtest-only orchestration engine.
- Precision Backtest calls the extracted Multi decision path and the shared
  `src/lib/trading` calculation path.
- Runtime orchestration contains no import of production singleton, storage,
  exchange factory, notifications, withdrawal, MCP, or production timers.
- Engine contracts can accept future live/sandbox adapters without changing
  stage semantics or public engine methods.
- The Precision Backtest no longer calls
  `runBacktestVolatilityDynamic` for trading behavior.
- The old dynamic backtest may remain temporarily for legacy pages and Quick
  Backtest, but it is not considered the Precision Backtest.
- Backtest processes every logical one-minute close without sleeping.
- Backtest does not preload completed vPoints, call private exchange APIs,
  notify, withdraw, use MCP, or access live/sandbox state.
- Backtest does not force-close positions at the end of the range.
- Repeated runs produce identical domain state, actions, and final positions.
  Wall-clock duration measurements are explicitly excluded from deterministic
  equality.

TC: `BOTH:SHARED_RUNTIME_ENGINE`

For this phase, that TC means the backtest uses the shared-capable runtime
engine and the engine passes contract tests with both backtest adapters and
fake production-shaped adapters. It does not mean production is cut over.

## 2.2 Future full-runtime completion

The full runtime migration is a later phase. It will be complete when live,
sandbox, and Precision Backtest call the same runtime engine and Multi plugin,
their differences are limited to adapters, and production uses one
aligned-minute dispatcher instead of five independent stage timers. Those
production changes are design constraints for the current engine, not current
implementation work.

# 3. Current-state audit

The coding agent must understand these existing files before changing them.

## 3.1 Precision stubs

- `src/lib/precision/index.ts` contains an empty `precisionRuntime` function.
- `src/lib/precision/types.ts` currently models `clock` as a number and only
  exposes `market.getKlines`.
- Replace these stubs. Do not preserve their current API for compatibility.

## 3.2 Production runtime

This section is reference material used to keep the new contracts compatible
with a future production integration. Do not modify these modules in the
backtest-first phase.

- `src/lib/slowTrading/runner.ts` creates one independent timer per stage.
- Risk Sentinel and Management can run outside the serialized stage queue.
- `src/lib/slowTrading/stages.ts` already owns the stage order, cadence
  normalization, Speedup rules, and stage-symbol selection.
- `src/lib/slowTrading/cycle/coordinator.ts` already prepares one public market
  snapshot and processes accounts sequentially.
- `src/lib/slowTrading/cycle/index.ts` builds an account runtime and currently
  calls Entry before Monitoring.
- `src/lib/slowTrading/cycle/planning.ts` owns stage eligibility and guards.
- `src/lib/slowTrading/cycle/entry.ts` owns entry authorization and execution.
- `src/lib/slowTrading/cycle/monitoring.ts` executes exits before averaging.
- `src/lib/slowTrading/cycle/finalize.ts` performs reporting and persistence.
- `src/lib/slowTrading/management.ts` is a separately scheduled management
  pipeline.
- `src/lib/slowTrading/black-swan.ts` separately captures shared evidence and
  applies it to accounts.
- `src/lib/slowTrading/mutation-queue.ts` serializes production mutations.

The shared-market preparation in
`src/lib/slowTrading/cycle/shared-market.ts` currently derives
`currentTimeMs` from `currentTimeKline[0]`, the five-minute candle open time.
The new engine must instead use the logical time from `RuntimeClock`. Market
data may confirm visibility; it must not replace the engine clock.

## 3.3 Legacy backtest

`src/lib/dynamic/backtest-volatility/index.ts` is not the target runtime path:

- It advances only through precomputed vPoint timestamps.
- It preloads completed vPoints and crops them by timestamp.
- It performs Entry, then Averaging, then Exit.
- It has separate entry, averaging, exit, fee, and balance code.
- It force-closes every remaining position at the end.

Those differences are precisely what the Precision project must remove. Do not
wrap this loop and call it the shared engine.

## 3.4 Trading execution coupling

The three shared trading entry points are exposed by `src/lib/trading/index.ts`:

```ts
trading.execution.entry(...)
trading.execution.averaging(...)
trading.execution.exit(...)
```

They currently obtain exchange adapters globally with `getExchange`, fetch
market data internally when no candle is supplied, and may notify internally.
`executeAveraging` infers simulation from
`position.executionMode === "sandbox"`. These functions need small injection
seams before the shared engine can safely call them in backtest. Do not copy
their calculations into `src/lib/backtest`.

## 3.5 Existing tests to preserve

The most important existing coverage is:

- `src/__dev__/main/quality/specs/runtime.test.ts`
- `src/__dev__/main/quality/end-to-end/slow-cycle.test.ts`
- `src/__dev__/main/quality/end-to-end/slow-black-swan-multi-account.test.ts`
- `src/__dev__/main/quality/specs/multi-accounts.test.ts`
- `src/__dev__/main/quality/specs/entry.test.ts`
- `src/__dev__/main/quality/specs/exit.test.ts`
- `src/__dev__/main/quality/specs/watch.test.ts`
- `src/__dev__/main/quality/specs/storage.test.ts`
- `src/__dev__/main/quality/unit/black-swan.test.ts`
- `src/__dev__/main/quality/unit/backtest-volatility-dataset.test.ts`
- `src/__dev__/main/quality/unit/slow-quick-backtest.test.ts`

Do not weaken or delete these tests merely because the module owner changes.

# 4. Target module layout

Create this structure incrementally:

```text
src/lib/precision/
  index.ts
  types.ts
  runtime/
    index.ts
    create.ts
    engine.ts
    schedule.ts
    stages.ts
    metrics.ts
    errors.ts
src/lib/strategies/
  index.ts
  multi/
    index.ts

src/lib/backtest/
  index.ts
  dataset/
    index.ts
    types.ts
    validate.ts
    build.ts
  adapters/
    clock.ts
    market.ts
    execution.ts
    storage.ts
    effects.ts
  runner/
    index.ts
    result.ts

src/driver/
  backtest.ts
```

Do not create `src/lib/precision/adapters/production/**` in this phase. The
current engine owner is `src/lib/precision/runtime`, and the historical runner
owner is `src/lib/backtest`. Production adapters are a later integration layer
and must not leak into either owner.

Public facades:

```ts
import precision from "@/lib/precision";
import strategies from "@/lib/strategies";
import backtest from "@/lib/backtest";

precision.runtime.create(...)
precision.runtime.schedule.getDueStages(...)
strategies.get("multi")
backtest.dataset.load(...)
backtest.runner.run(...)
```

`index.ts` files export one grouped default object and explicit public types.
They must not broadly re-export internal implementation functions.

TC: `BOTH:MODULE_BOUNDARIES`

# 5. Canonical runtime types

Replace `src/lib/precision/types.ts` with concrete shared contracts. Reuse
existing imported types; do not duplicate their fields.

```ts
export type RuntimeMode = "live" | "sandbox" | "backtest";
export type ProductionRuntimeMode = Exclude<RuntimeMode, "backtest">;

export type RuntimeStage = SlowTradingStage;

export interface RuntimeClock {
  readonly mode: RuntimeMode;
  now(): number;
}

export interface RuntimeCatalog {
  accounts: SlowTradingAccount[];
  config: SlowTradingManagementConfig;
  runtime: SlowTradingSettingsRuntimeConfig;
}

export interface RuntimeAccountState {
  account: SlowTradingAccount;
  config: DynamicTradeConfig;
  state: SlowTradingModeState;
}

export interface RuntimeStorageScope {
  account: string;
  mode: RuntimeMode;
}

export interface RuntimeStorage {
  catalog: {
    load(): Promise<RuntimeCatalog>;
  };
  account: {
    load(scope: RuntimeStorageScope): Promise<RuntimeAccountState>;
    commit(
      scope: RuntimeStorageScope,
      value: RuntimeAccountState,
    ): Promise<void>;
  };
}
```

`SlowTradingModeState` is the V1 runtime-state base. Do not create a parallel
position collection. Production storage translates its active `live` or
`sandbox` state into `RuntimeAccountState`. Backtest storage creates an
isolated `SlowTradingModeState` seeded from the test case.

Do not change `SlowTradingStorageData.modes` to include `backtest`; that object
is a production storage projection. Backtest mode exists at the Precision
runtime boundary, not as a third persistent production mode.

Update `PositionExecutionMode` in `src/lib/trading/models/type.ts` to include
`"backtest"`. Update the entry execution prop accordingly. New backtest
positions must write `executionMode: "backtest"`; do not continue the legacy
behavior of labelling them `sandbox`.

TC: `BOTH:SHARED_POSITION_TYPE`

# 6. Engine dependency contracts

The engine is initialized once with an immutable dependency pack:

```ts
export interface RuntimeEngineInput {
  mode: RuntimeMode;
  clock: RuntimeClock;
  market: RuntimeMarketSource;
  execution: RuntimeExecutionSource;
  storage: RuntimeStorage;
  strategy: StrategyPlugin;
  effects: RuntimeEffects;
  metrics: RuntimeMetrics;
  logger: RuntimeLogger;
}

export interface RuntimeEngine {
  runMinute(input?: { t?: number }): Promise<RuntimeMinuteResult>;
  runStage(input: {
    stage: RuntimeStage;
    t?: number;
  }): Promise<RuntimeStageResult>;
}
```

The engine is request-driven. It must not start a timer, iterate a historical
range, read process environment variables, or import an application bootstrap.
Environment drivers own cadence:

```text
current backtest driver:
  for each historical minute -> engine.runMinute({ t })

future production dispatcher:
  on each aligned real minute -> engine.runMinute({ t })
```

This separation is what makes the engine usable later from
`src/instrumentation.ts`. The backtest runner owns fast historical iteration;
the future production runner owns sleeping, missed-minute policy, shutdown,
and process lifecycle. Neither behavior belongs inside the engine.

`createRuntimeEngine(input)` validates dependency compatibility and returns the
engine. Reject initialization when:

- `clock.mode !== mode`.
- A live engine receives backtest execution or storage.
- A backtest engine receives production execution, production storage, or
  production effects.
- Stage intervals are invalid after normalization.
- The strategy id does not match the run configuration.
- No eligible account or symbol exists.

Adapters expose a stable discriminant such as `kind` so validation does not
depend on `instanceof` across bundles.

```ts
interface RuntimeAdapterIdentity {
  kind: "production" | "sandbox" | "backtest";
}
```

TC: `BOTH:RUNTIME_INITIALIZATION`
TC: `BOTH:RUNTIME_ADAPTER_BOUNDARIES`
TC: `BOTH:RUNTIME_SAFETY_GUARDS`

Current-phase tests must provide:

- real backtest adapters for the end-to-end path;
- small fake `production` and `sandbox` adapter packs that prove the contracts
  are not backtest-specific;
- no real production adapter implementation and no production bootstrap.

# 7. Logical time

## 7.1 Time definition

All runtime logical times are exact UTC minute boundaries in Unix
milliseconds. Example: `12:05:00.000` represents the close of the candle whose
exchange close timestamp is `12:04:59.999`.

Market visibility rule:

```ts
klineCloseTime <= logicalTimeMs
```

An exchange candle with close time `logicalTimeMs - 1` is therefore visible.
An in-progress candle closing after logical time is not visible.

Do not use a candle's open time as the runtime time.

## 7.2 Future system clock contract

A later `production/clock.ts` adapter will return real time rounded down to the
current minute boundary for a requested dispatch. The future runner should
wake shortly after the boundary so the exchange can expose the completed
candle, but the logical time remains the boundary, not the later wall time.
Do not implement or wire that adapter in the backtest-first phase.

## 7.3 Dataset clock

The backtest clock is controlled only by the backtest runner:

```ts
interface BacktestClock extends RuntimeClock {
  set(t: number): void;
}
```

The engine only calls `now()`. It must not call `set` or advance time.

`runRange` iterates exact minute boundaries where:

```text
t > startTime && t <= endTime
```

There is no `setTimeout`, sleep, or wall-clock dependency in backtest.

## 7.4 Prohibited time reads

Replace decision-path `Date.now()` reads only in code extracted into or called
by the Precision Backtest engine. Do not perform a broad production-runtime
refactor in this phase. The eventual migration must cover:

- cycle planning and daily PnL guards;
- shared-market preparation;
- entry final guards;
- reporting timestamps;
- stage-run records;
- Black Swan evidence and transitions;
- position open, average, and close events;
- strategy diagnostics and action logs.

`performance.now()` or an injected profiler clock remains valid only for
duration measurement. Duration fields never influence a decision.

TC: `BOTH:RUNTIME_LOGICAL_CLOCK`

# 8. Scheduler

Implement a pure scheduler in `src/lib/precision/runtime/schedule.ts`.

```ts
interface GetDueStagesInput {
  runtime: Pick<
    SlowTradingRuntimeConfig,
    | "blackSwanStageIntervalMinutes"
    | "speedupStageIntervalMinutes"
    | "standardMonitoringStageIntervalMinutes"
    | "managementStageIntervalMinutes"
    | "captureEntryStageIntervalMinutes"
  >;
  t: number;
}
```

Rules:

1. Reject a non-finite or non-minute-aligned `t`.
2. Resolve intervals using the existing normalization logic from
   `slowTradingStages.interval`.
3. Calculate `epochMinute = Math.floor(t / 60_000)`.
4. A stage is due when `epochMinute % intervalMinutes === 0`.
5. Return stages in `SLOW_TRADING_STAGE_ORDER`.

At default intervals:

```text
12:00 risk-sentinel, speedup, standard-monitoring, management, capture-entry
12:01 risk-sentinel, speedup
12:02 risk-sentinel, speedup
12:03 risk-sentinel, speedup
12:04 risk-sentinel, speedup
12:05 risk-sentinel, speedup, standard-monitoring, management, capture-entry
```

For the current phase, import and reuse the existing stage constants and
normalization helpers where their dependencies are safe, or extract a pure
shared helper without rerouting production callers. Do not make
`slowTradingStages` delegate to the new engine now. The later production
cutover must end with one stage-order and interval implementation.

## 8.1 Duplicate prevention

Use `modeState.stageRuns[stage].t` as the last completed logical time inside
the backtest state. Add a Precision-owned pure helper that records an injected
`logicalTimeMs`; do not change `slowTradingStageRun.recordCompleted` or its
production callers in this phase.

Before a stage runs for an account, ignore it when the persisted stage record
already has the same logical time. Do not mark a failed stage complete.

Within the new Precision state path, `t` always means logical time. Update
Precision fixtures directly and do not add a compatibility interpretation.
Leave the current production stage-record writer unchanged until the future
production phase.

## 8.2 Future production dispatcher — explicitly deferred

Do not replace the five independent loops in `SlowTradingRunner` now. During a
later production integration, replace them with one dispatcher:

1. Calculate the next minute boundary.
2. Wake shortly after it.
3. Resolve the logical boundary time.
4. Load current runtime configuration.
5. Call `getDueStages`.
6. Execute each due stage sequentially in returned order.
7. Schedule the next boundary.

If the process wakes after one or more boundaries were missed, log/measure the
missed count and execute only the current boundary. Never replay production
trades for previous minutes.

The future manual `tickNow()` resolves one logical minute and calls the same engine. A
manual stage request may call `runStage`, but it still uses duplicate
protection.

Production-only queue scheduling and withdrawal processing may later run as a hook
before Capture Entry. They remain outside the shared trading engine and are not
initialized in backtest.

TC: `BOTH:RUNTIME_SCHEDULING`
TC: `BOTH:RUNTIME_DETERMINISTIC_ORDER`
`PROD:RUNTIME_MISSED_CYCLE_POLICY` is deferred until production integration.

# 9. Deterministic ordering

The engine must explicitly sort or retain order at these boundaries:

- Stages: fixed canonical stage order.
- Accounts: order in `RuntimeCatalog.accounts`; do not alphabetize accounts.
- Symbols: normalize to uppercase without `_USDT`, remove duplicates, then
  sort with `localeCompare`.
- Positions: preserve persisted array order.
- Actions for one position: forced/risk exit, normal exit, averaging.
- Capture Entry actions: sorted symbol order after decision filtering.

At a five-minute boundary, monitoring completes before Capture Entry. A
position closed in monitoring may free worker capacity for Capture Entry at
that same logical time.

This is an intentional change from the current production call order
(`Entry -> Monitoring`) and legacy backtest order
(`Entry -> Averaging -> Exit`). The target is:

```text
Risk/forced exit -> normal exit -> averaging -> entry
```

Add an explicit regression test for this change. Do not rely on incidental
function-call order.

TC: `BOTH:RUNTIME_DETERMINISTIC_ORDER`
TC: `BOTH:RUNTIME_EXIT_PRIORITY`

# 10. Runtime market source

Define one shared contract:

```ts
interface RuntimeMarketRequest {
  t: number;
  stage: RuntimeStage;
  symbols: string[];
  config: DynamicTradeConfig;
  lookback?: {
    oneMinute?: number;
    fiveMinute?: number;
  };
}

interface RuntimeMarketSnapshot {
  t: number;
  symbols: string[];
  latestOneMinuteBySymbol: Record<string, Kline>;
  latestFiveMinuteBySymbol: Record<string, Kline>;
  volatilityMemoryBySymbol: Record<string, PredictionEngineMemory>;
  latestKlineBySymbol: LatestKlineBySymbol;
  prices: RuntimePriceSource;
  fundingRates: RuntimeFundingSource;
  volume24h: RuntimeVolumeSource;
  blackSwan?: RuntimeBlackSwanMarket;
}

interface RuntimeMarketSource extends RuntimeAdapterIdentity {
  snapshot(input: RuntimeMarketRequest): Promise<RuntimeMarketSnapshot>;
}
```

Every returned candle must satisfy `Number(kline[6]) <= request.t`. Snapshot
construction rejects a future candle instead of cropping it silently after it
has already influenced a calculation.

The snapshot object is immutable after publication. Account processing clones
volatility memory before adding account-owned used-vPoint state.

## 10.1 Future production market adapter — explicitly deferred

Do not refactor `src/lib/slowTrading/cycle/shared-market.ts` in the current
phase. A later `production/market.ts` adapter must preserve these rules:

- Accept `t` from the engine.
- Keep existing single-flight and freshness behavior.
- Keep bounded public request concurrency.
- Prepare public volatility once for the union of stage symbols.
- Never replace `t` with a kline open time.
- Reject in-progress candles.
- Retain lazy price, funding, and 24-hour volume loaders.

## 10.2 Empty stage

If preflight stage selection yields no symbol for every eligible account:

- Do not call `market.snapshot`.
- Do not call private balance or position APIs.
- Record successful empty stage statistics for each applicable account.

TC: `BOTH:RUNTIME_SHARED_MARKET_SNAPSHOT`
TC: `PROD:EMPTY_MONITORING_NO_MARKET_IO`

# 11. Backtest dataset

Create a new raw-kline dataset. Do not reuse the compact precomputed-vPoint
cache in `src/lib/devBacktest/volatility-dataset` as the Precision dataset.

The high-level schema is the base. The technical implementation also needs
deterministic exchange rules used by shared execution:

```ts
interface BacktestDatasetV1 {
  schema: 1;
  sourceExchangeType: ExchangeType;
  marketType: "SPOT" | "FUTURES";
  warmupStartTime: number;
  startTime: number;
  endTime: number;
  symbols: string[];
  klines: Record<
    string,
    {
      "1m": Kline[];
      "5m": Kline[];
    }
  >;
  executionRules: Record<
    string,
    {
      minQty: number;
      stepSize: number;
      tickSize: number;
      makerFeePct: number;
      takerFeePct: number;
    }
  >;
}
```

Before implementing this extension, update the schema example in
`HIGH_LEVEL/BACKTEST.md` so the documents remain consistent.

Store compact JSON under `storage/backtest-dataset`. Dataset file naming must
be a stable hash of:

- dataset schema/version;
- source exchange and market type;
- normalized, deduplicated, sorted symbols including BTC;
- effective `warmupStartTime`, `startTime`, and `endTime` after boundary
  normalization.

Do not include credentials, account identity, trading configuration, or
`upToDateKlines` in the key. The freshness flag controls whether a matching
entry may be reused; it does not describe the dataset's identity.

## 11.1 Cache lookup and build behavior

Dataset access is cache-first:

1. Normalize the request and calculate the cache key before any network call.
2. When `upToDateKlines` is false or absent, open and validate the matching
   cached dataset.
3. On a valid hit, return it without fetching any kline interval.
4. On a miss or invalid/corrupt entry, acquire a per-key build lock, check the
   cache again, then fetch the independent 1m and 5m series once.
5. Validate the complete built dataset and publish compact JSON through a
   temporary file plus atomic rename.
6. When `upToDateKlines` is true, deliberately rebuild and atomically replace
   the matching entry instead of returning it. Concurrent forced refreshes for
   the same key still share one in-flight build.

The per-key lock/single-flight mechanism must work for concurrent requests in
the server process. The second waiter reads the file produced by the first;
it must not repeat the download. A different symbol set or effective range has
a different key and may build independently.

TC: `BTEST:BACKTEST_DATASET_CACHE`

## 11.2 Dataset validation

`validate.ts` must reject:

- Unsupported schema.
- Missing BTC.
- Symbols that are not normalized, unique, and sorted.
- Missing 1m or 5m series for a symbol.
- Empty series.
- Non-finite or reversed time bounds.
- A candle whose tuple does not contain valid open and close times.
- Out-of-order or duplicate candle open times.
- A cadence gap inside required coverage.
- Coverage that starts after `warmupStartTime` or ends before `endTime`.
- A 1m candle not spaced by exactly 60,000 ms from its predecessor.
- A 5m candle not spaced by exactly 300,000 ms from its predecessor.
- Missing or invalid execution rules.

One-minute and five-minute candles are fetched and stored independently. Never
derive 5m candles from the 1m series.

## 11.3 Data unavailable from klines

V1 derives rolling 24-hour quote volume from the latest visible 1m candle
window by summing tuple index `7`.

Historical market cap and historical funding snapshots are not available in
the base dataset. The backtest market adapter must never substitute current
internet data. When an enabled configuration requires unavailable historical
data, fail before the run with an explicit unsupported-input error. At minimum:

- Fail when `autoRemoveSymbolMinMarketCapUSD > 0` and the dataset has no
  historical market-cap series.
- Fail when a strategy guard requires funding and the dataset has no historical
  funding series.

Future schemas may add those time series. Do not silently disable their rules.

TC: `BTEST:BACKTEST_DATASET`

# 12. Backtest market visibility and vPoint formation

The backtest market adapter indexes the validated arrays once. It must use a
cursor or binary search; do not filter complete arrays for every request.

At logical time `t`:

- Return only candles with `closeTime <= t`.
- `latestOneMinuteBySymbol[symbol]` is the latest visible completed 1m candle.
- `latestFiveMinuteBySymbol[symbol]` is the latest visible completed 5m candle.
- Throw when required coverage is missing.
- Warmup candles may update indicators and vPoint detector memory.
- No trading action is allowed at or before `startTime`.

## 12.1 Streaming vPoint detector

The detector must observe each newly visible 5m candle exactly once. A vPoint
becomes visible only on the candle that confirms the required retrace. The
vPoint's own `t` and `p` remain the historical peak/bottom values created by
the existing detector; visibility begins at the later confirmation time.

Do not reinvent the algorithm. Refactor the existing detector only enough to
expose a streaming state that uses the existing `predictor` function and the
same level-transition logic used by `detectVolatilityPoints`.

Required proof before using the stream:

```text
for every golden kline fixture:
  batch = detectVolatilityPoints(allKlines)
  streamed = feed the same klines one at a time
  expect(streamed.points).toEqual(batch)
```

The test must cover TOP, BOTTOM, repeated same-side levels, a neutral reset,
and the 1% retrace confirmation. Do not change point ids, peak times, prices,
percentages, volumes, or levels.

An entry or averaging action triggered by a newly visible vPoint executes at
the current logical time and latest visible 1m close, not at the vPoint peak
time or price. `opened.vPoint.id` still stores the source point identity.

TC: `BOTH:BACKTEST_CANDLE_VISIBILITY`
TC: `BTEST:VPOINT_FORMATION_VISIBILITY`

# 13. Strategy plugin

Create the Multi plugin in `src/lib/strategies/multi/index.ts`. It is a thin
owner of strategy decisions, not a copy of runtime orchestration.

```ts
interface StrategyInput {
  account: RuntimeAccountState;
  market: RuntimeMarketSnapshot;
  stage: RuntimeStage;
  t: number;
}

interface StrategyDecision {
  entryRecommendations: EntryRecommendation[];
  averagingRecommendations: AveragingRecommendation[];
  exitSymbols: string[];
  diagnostics: RuntimeDecisionDiagnostic[];
}

interface StrategyPlugin {
  id: StrategyId;
  decide(input: StrategyInput): Promise<StrategyDecision>;
}
```

The Multi plugin delegates to existing behavior:

- Entry recommendation: current decision engine selected by
  `decisionEngineVersion` and existing `slowTradingSignals` filters.
- Exit decision: existing `dynamicExit` path used by
  `trading.execution.exit`.
- Averaging recommendation: existing
  `slowTradingWatchReserve.averaging.generateRecommendations`.
- Sizing and execution guards remain shared runtime/trading responsibilities.

Refactor `slowTradingSignals.build` so its decision core can accept an injected
account state and market snapshot. It must not reload storage or fetch market
data when called by the plugin.

The plugin must not import production storage, notification, exchange factory,
withdrawal, MCP, or `Date.now()`.

TC: `BOTH:PLUGIN_STRATEGY`

# 14. Stage execution

`runtime/stages.ts` owns stage-specific orchestration. Reuse the current pure
stage-symbol and Speedup-classification helpers.

## 14.1 Risk Sentinel

1. Request BTC and required breadth 1m candles once.
2. Evaluate shared evidence at logical time.
3. Apply evidence to accounts sequentially.
4. Persist account Black Swan state.
5. Convert emergency exits into forced-exit actions.
6. Execute and commit those exits before Speedup starts.

The future production effects adapter may notify after commit. Backtest
effects are no-op. Do not add production effects wiring now.

## 14.2 Speedup

1. Preflight using open-position symbols.
2. Prepare shared volatility for their union.
3. Classify exact account positions using persisted PnL and shared volatility.
4. Execute exits first.
5. Rebuild open positions.
6. Execute averaging only for positions still open.

## 14.3 Standard Monitoring

Use the complement of Speedup ownership for this logical time. A symbol or
position processed by Speedup must not run again in Standard. Refresh canonical
monitoring PnL/funding state only for selected open positions.

## 14.4 Management

Use shared latest visible price and vPoint state. It does not call strategy,
balance, entry, averaging, exit, or private exchange APIs. Apply symbol removal
to the runtime catalog/config state. Backtest uses its in-memory catalog only.

## 14.5 Capture Entry

1. Select configured symbols without an open position.
2. Ask the strategy for recommendations.
3. Apply Black Swan, daily PnL, worker, used-vPoint, level, symbol, minimum
   price, balance, reserve, leverage, and late-price guards.
4. Fetch/authorize a private balance only when a candidate survives all public
   guards in live mode.
5. Execute candidates in sorted symbol order.
6. Commit after each successful action.

A disabled account cannot enter. A disabled account with an open position is
still eligible for Risk, Speedup, and Standard exit handling.

TC: `BOTH:RUNTIME_STAGE_OWNERSHIP`
TC: `BOTH:RUNTIME_EXECUTION_CYCLE`
TC: `BOTH:RUNTIME_ACCOUNT_ISOLATION`

# 15. Execution source and trading-function injection

Use one concrete discriminated action union, not a generic event framework:

```ts
type RuntimeTradingAction =
  | RuntimeEntryAction
  | RuntimeAveragingAction
  | RuntimeExitAction;

interface RuntimeExecutionSource extends RuntimeAdapterIdentity {
  execute(action: RuntimeTradingAction): Promise<RuntimeExecutionResult>;
}

interface RuntimeExecutionResult {
  status: "executed" | "skipped" | "failed";
  report: TradingReturn;
}
```

Each action contains mode, account slug, stage, logical time, symbol, the
existing recommendation or position reference, and the existing config/state
required by `src/lib/trading`.

## 15.1 Minimal injection changes

Modify shared trading functions without copying their math:

- `executeEntry`:
  - accept `executionMode: RuntimeMode`;
  - accept optional injected `exchange: IExchange`;
  - require an injected completed `current` candle from the engine;
  - accept `executionTimeMs` and persist it in `opened.t`;
  - support `notify: boolean` or an injected notifier, defaulting to current
    production behavior during migration.
- `executeExit`:
  - accept optional injected `exchange`;
  - require injected `current` in engine calls;
  - accept `executionTimeMs` and use it for `closed.t`;
  - support disabled notification.
- `executeAveraging`:
  - accept explicit `executionMode` or `simulate`; do not infer solely from the
    position;
  - accept optional injected `exchange`;
  - accept injected completed `current`;
  - accept `executionTimeMs` and use it for averaging execution timestamps;
  - support disabled notification.

Defaults may preserve legacy callers until cutover. Precision engine callers
must always inject exchange, candle, time, mode, and notification behavior.

These are the only permitted touches to production-used trading modules in the
backtest-first phase. They must be narrow optional injection seams whose
defaults preserve every existing live and sandbox caller. Do not move
production orchestration, change default execution behavior, or require a
production caller migration to finish the backtest.

## 15.2 Backtest execution adapter

The backtest adapter calls these same three trading functions with:

- dataset-backed exchange rules;
- latest visible completed 1m candle;
- `executionMode: "backtest"`;
- simulation enabled;
- logical execution time;
- notification disabled;
- deterministic slippage applied to a cloned execution candle before calling
  the shared function.

No randomness, latency, partial fills, or rejection exists in V1.

## 15.3 Future production execution adapter — explicitly deferred

Do not implement this adapter now. A future production adapter will supply the
real exchange and must preserve current live order behavior, client-order
idempotency, leverage/margin setup, quantity adjustment, close confirmation,
and reconciliation.

The future sandbox adapter will use public production market data and sandbox state but call the
simulation branch. It must not submit an exchange order.

## 15.4 Action atomicity

Before each balance-changing action:

1. Clone the current account state.
2. Execute against the clone.
3. If skipped or failed, discard the clone except for non-domain diagnostics.
4. If executed, commit the clone atomically.
5. Replace the engine's in-memory state with the committed clone.

Future production integration must stop an account and report an uncertain
state if a live exchange order succeeds but persistence fails. It must not
resubmit automatically; the next production cycle must reconcile against
exchange state. No live order path is implemented or exercised in the current
phase.

Build live client ids from a stable idempotency key containing account, stage,
logical time, action kind, symbol, and position/source-vPoint identity. Hash or
truncate to the exchange limit.

TC: `BOTH:RUNTIME_ACTION_COMMIT`
TC: `BTEST:BACKTEST_MARKET_FILL`
TC: `BOTH:RUNTIME_MODE_ISOLATION`

# 16. Storage adapters

## 16.1 Future production storage — explicitly deferred

Do not wrap or reroute `slowTradingStorage` now. A future production adapter
must:

- Catalog loading uses the current account catalog plus shared config/runtime.
- Account loading projects only the requested active `live` or `sandbox` state.
- Effective per-account trading config continues to use
  `slowTradingAccountConfig.trading.toEffectiveConfig`.
- Commit uses the existing mutation queue and atomic JSON persistence.
- Shared public volatility remains outside account mode memory.

Reload the account immediately before its stage runs. Do not reuse a stale
account snapshot prepared before another stage committed.

## 16.2 Backtest storage

Use an in-memory adapter seeded from request config and `initialState`:

- Remove account credentials before seeding.
- Create one isolated scope per enabled account.
- Starting balance comes from that account's
  `sandbox.initialBalanceUSDT` unless the test case explicitly supplies a
  captured initial state.
- Commit replaces only the matching account scope.
- Return deep clones from load and accept deep clones on commit.
- Never import `slowTradingStorage` persistence functions.

The backtest child still receives an isolated `PERSISTENT_STORAGE_ROOT` as a
defense against accidental legacy imports, but the canonical adapter remains
in memory. Only dataset/result files are deliberately written.

TC: `BOTH:RUNTIME_ACCOUNT_ISOLATION`
TC: `BOTH:RUNTIME_MODE_ISOLATION`

# 17. Runtime effects

Do not introduce an event bus. Use a grouped, named effects interface:

```ts
interface RuntimeEffects extends RuntimeAdapterIdentity {
  entry(result: RuntimeExecutionResult): Promise<void>;
  averaging(result: RuntimeExecutionResult): Promise<void>;
  exit(result: RuntimeExecutionResult): Promise<void>;
  dailyPnlLimit(input: RuntimeDailyPnlEffect): Promise<void>;
  highVolatility(input: RuntimeVolatilityEffect): Promise<void>;
  openPositions(input: RuntimeOpenPositionsEffect): Promise<void>;
  management(input: RuntimeManagementEffect): Promise<void>;
  operationalError(input: RuntimeErrorEffect): Promise<void>;
}
```

Backtest effects are strict no-op implementations and expose counters so tests
can assert that no external effect was attempted. A future production effects
adapter will delegate to existing notifications/logging after state commit;
do not implement or wire it in this phase.

Daily performance aggregation, withdrawal, Safe Haven transfer execution,
queue processing, MCP, and dashboard refresh are production services outside
the engine. If Safe Haven balance calculation is strategy/accounting behavior,
keep the calculation shared but keep real transfer scheduling production-only.

TC: `BOTH:RUNTIME_ADAPTER_BOUNDARIES`
TC: `BOTH:RUNTIME_SAFETY_GUARDS`

# 18. Stage results and metrics

Define deterministic result records:

```ts
interface RuntimeActionRecord {
  account: string;
  kind: "entry" | "averaging" | "exit";
  positionKey?: string;
  sourceVPointId?: string;
  stage: RuntimeStage;
  status: "executed" | "skipped" | "failed";
  symbol: string;
  t: number;
  reason?: string;
}

interface RuntimeStageResult {
  stage: RuntimeStage;
  t: number;
  accounts: RuntimeAccountStageResult[];
  actions: RuntimeActionRecord[];
  metrics: RuntimeStageMetrics;
}

interface RuntimeMinuteResult {
  t: number;
  stages: RuntimeStageResult[];
}
```

Metrics include:

- stage and section wall duration;
- public/private market calls;
- execution attempts and fills;
- storage loads and commits;
- cache hits;
- retries and errors;
- rate-limit/cooldown observations;
- eligible/skipped accounts and symbols.

Trading decisions must never read metrics. Do not place credentials or raw
private exchange payloads in action records or final position JSON.

For reproducibility, compare or hash a normalized result that removes only
wall-duration fields. API counts, actions, errors, final states, and logical
times remain deterministic and comparable.

TC: `BOTH:RUNTIME_METRICS`
TC: `BTEST:BACKTEST_METRICS`

# 19. Failure behavior

Use typed errors in `runtime/errors.ts`:

- `RuntimeInitializationError`
- `RuntimeMarketDataError`
- `RuntimeFutureDataError`
- `RuntimeStorageError`
- `RuntimeExecutionError`
- `RuntimeUnsupportedBacktestInputError`
- `RuntimeModeIsolationError`

Rules:

- Backtest: fail the entire run on invalid/missing market data, invalid state,
  unsupported input, failed execution, or failed commit. Do not write a success
  result.
- Future production integration must preserve the current shared-market,
  account-isolation, rate-limit, and cooldown behavior. Those branches are not
  implemented by the backtest-first phase.
- Optional funding/reporting failure: retain the last valid value and continue
  only where existing specifications say it is supplementary.
- A closed position must never receive another action in the same minute.

TC: `PROD:RUNTIME_FAILURE_ISOLATION`
TC: `BTEST:BACKTEST_REPRODUCIBLE`

# 20. Backtest runner and child process

## 20.1 In-process runner library

`src/lib/backtest/runner/index.ts`:

1. Validate request/config.
2. Load and validate the raw dataset.
3. Create dataset clock, market, execution, storage, effects, and metrics.
4. Resolve the Multi strategy plugin.
5. Create the shared runtime engine in `backtest` mode.
6. Feed warmup candles to market/vPoint state without trading.
7. Iterate minute boundaries after `startTime` through `endTime`.
8. Call `engine.runMinute({ t })`.
9. Collect action records and metrics.
10. Return each account's canonical final state and all positions, including
    positions closed during the run.
11. Do not force-close open positions.

For multiple enabled accounts, execute account work sequentially in configured
order. The persisted Precision run schema remains account-scoped. A transient
API batch may return a list of account-scoped results; do not invent one merged
position identity.

## 20.2 Driver protocol

`src/driver/backtest.ts` is a small process entry point. It receives input and
output file paths through arguments, reads compact JSON, runs the library, and
writes the result atomically.

Suggested arguments:

```text
--input /tmp/.../input.json
--output /tmp/.../output.json
--dataset /absolute/storage/backtest-dataset/<id>.json
```

The driver must:

- Refuse a `PERSISTENT_STORAGE_ROOT` that is absent, points to the project live
  storage, or lacks a marker created for this run.
- Set/require `DISABLE_SLOW_TRADING_RUNNER=1`.
- Never import the SLOW singleton or start production scheduling.
- Return a non-zero exit code and structured stderr on failure.
- Write output through a temporary file plus rename.

## 20.3 API process launcher

Update `src/lib/dev/backtestPrecision/api/run.ts`:

1. Validate `BacktestPrecisionParams`.
2. Normalize/sort management symbols and include BTC.
3. Remove account credentials from the child payload.
4. Resolve the range-and-symbol dataset key and load the validated cache by
   default; build it only on a miss, corruption, or explicit
   `upToDateKlines: true` refresh.
5. Create a temp directory with `fs.mkdtemp`.
6. Create an isolated persistent root and marker inside it.
7. Spawn Node with `require.resolve("tsx/cli")` and
   `src/driver/backtest.ts` for the development endpoint.
8. Pass a sanitized environment.
9. Capture bounded stdout/stderr.
10. Read and validate the result.
11. Delete the temp directory in `finally`.
12. Return the new Precision Backtest response.

Strip at least these environment variables from the child:

```text
BINANCE_API_KEY
BINANCE_API_SECRET
BINANCE_SECRET_KEY
BINANCE_1_API_KEY
BINANCE_1_API_SECRET
BINANCE_1_SECRET_KEY
BINANCE_2_API_KEY
BINANCE_2_API_SECRET
BINANCE_2_SECRET_KEY
OKX_API_KEY
OKX_API_SECRET
OKX_API_PASSPHRASE
TOKOCRYPTO_API_KEY
TOKOCRYPTO_API_SECRET
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
EMAIL_TO
N8N_EMAIL_PROXY_TOKEN
N8N_EMAIL_PROXY_URL
MCP_TOKEN_ENCRYPTION_SECRET
SYNC_TOKEN
```

Use public unauthenticated market endpoints only while building the dataset.
Do not log the full request because account objects may contain credentials.
Log only run id, symbols, range, enabled account slugs, dataset id, elapsed
time, and final status.

The current placeholder `console.log("params", params)` must be removed.

TC: `BTEST:BACKTEST_PROCESS_ISOLATION`
TC: `BTEST:BACKTEST_REPRODUCIBLE`
TC: `BTEST:BACKTEST_DATASET_CACHE`

# 21. Precision Backtest API and page integration

`BacktestPrecisionParams` continues to receive:

- range or explicit start/end;
- freshness controls;
- grouped SLOW settings;
- symbols from `config.management.symbols`;
- per-account starting balance from each enabled account's sandbox config.

The backend, not the browser, is authoritative for validation and BTC
inclusion.

Replace the placeholder `{ data: true }` response with the account-scoped
Precision Backtest result list and aggregate metrics. Update
`BacktestPrecision/MainPage.tsx` to use the new response type instead of
`DynamicTradeBacktestReturn`. Do not coerce the new engine result into the
legacy dynamic shape inside the engine. If the page needs charts, create a
separate presentation converter.

The browser may continue saving temporary settings to localStorage. Running the
backtest sends those settings to the server; it does not save them into
production storage.

TC: `BTEST:BACKTEST_MANAGEMENT_SYMBOLS`
TC: `BTEST:MULTI_ACCOUNT_COMBINED_BACKTEST`

# 22. Implementation milestones

Each milestone must leave the repository type-safe and test-safe. Milestones
0–8 below are the complete scope of the current backtest-first implementation.
They are ordered so the first real application integration is
`src/lib/dev/backtestPrecision/api/run.ts`.

## Milestone 0 — Align documents and freeze fixtures

Files:

- `docs/PRECISION/HIGH_LEVEL/BACKTEST.md`
- checked-in JSON fixtures affected by canonical type changes

Work:

- Add deterministic execution rules to the dataset schema.
- Record unsupported historical-data behavior.
- Confirm logical-time boundary semantics.
- Record this backtest-first boundary in the high-level document if it still
  implies an immediate production cutover.

Exit gate: documents contain no conflicting dataset or logical-time rules.

## Milestone 1 — Characterization and detector parity

Files:

- existing quality tests listed in Section 3.5
- new `src/__dev__/main/quality/precision/volatility-stream.test.ts`
- new action-order characterization fixtures

Work:

- Add golden fixtures for current Multi entry, exit, averaging, stage
  classification, fees, PnL, and account order.
- Prove batch and streaming vPoint results are identical.
- Mark intentional old/new order differences explicitly.

Exit gate: tests describe the behavior that must survive extraction.

## Milestone 2 — Types, clock, and scheduler

Files:

- `src/lib/precision/types.ts`
- `src/lib/precision/runtime/create.ts`
- `src/lib/precision/runtime/schedule.ts`
- `src/lib/precision/runtime/index.ts`
- `src/lib/precision/index.ts`
- `src/lib/trading/models/type.ts`
- relevant fixtures

Tests:

- `runtime-clock.test.ts`
- `runtime-schedule.test.ts`
- `runtime-mode-guard.test.ts`

Exit gate: pure scheduling and initialization work without production runtime
changes. Fake adapter packs prove that the public API is not backtest-specific.

## Milestone 3 — Raw dataset and market adapter

Files:

- `src/lib/backtest/dataset/**`
- `src/lib/backtest/adapters/clock.ts`
- `src/lib/backtest/adapters/market.ts`
- vPoint streaming wrapper in the existing detector module

Tests:

- dataset validation for every rejection rule;
- identical normalized symbols/range reuse the cached dataset with zero kline
  network calls;
- changed symbols or range resolve to a different cache key;
- `upToDateKlines: true` refreshes and atomically replaces the same key;
- concurrent identical cache misses perform only one dataset download/build;
- 1m/5m independent visibility;
- warmup behavior;
- no-future-candle behavior;
- retrace-confirmed vPoint visibility;
- rolling 24h quote volume.

Exit gate: a deterministic market snapshot can be requested for any minute.

## Milestone 4 — Execution injection seams

Files:

- `src/lib/trading/execute/execute-entry.ts`
- `src/lib/trading/execute/execute-averaging.ts`
- `src/lib/trading/execute/execute-exit.ts`
- `src/lib/backtest/adapters/execution.ts`

Tests:

- same candle/config/state produces the same position/accounting result in
  sandbox and backtest except `executionMode`;
- timestamps use logical time;
- backtest cannot submit orders or notify;
- deterministic slippage;
- live defaults still satisfy existing tests.

Exit gate: no backtest-specific trading math is needed, and every existing
production caller continues to work through unchanged defaults.

## Milestone 5 — Multi strategy plugin

Files:

- `src/lib/strategies/index.ts`
- `src/lib/strategies/multi/index.ts`
- focused refactor of `src/lib/slowTrading/signals.ts`

Tests:

- existing v19/v20 tests run through the plugin;
- no future market data;
- plugin imports no production effects/storage modules;
- input objects are not mutated.

Exit gate: one plugin produces the current Multi decisions from injected state.

## Milestone 6 — Shared runtime engine

Files:

- `src/lib/precision/runtime/engine.ts`
- `src/lib/precision/runtime/stages.ts`
- `src/lib/precision/runtime/metrics.ts`
- `src/lib/precision/runtime/errors.ts`
- `src/lib/backtest/adapters/storage.ts`
- `src/lib/backtest/adapters/effects.ts`

Tests:

- stage/account/symbol/action order;
- exit prevents averaging;
- commit after each successful action;
- empty-stage no-I/O;
- disabled-account exit monitoring;
- account failure isolation;
- duplicate stage/time ignored;
- missing market data fails backtest;
- mode isolation.

Exit gate: engine passes with backtest adapters and fake production-shaped
adapters. No production module imports or calls it yet.

## Milestone 7 — Backtest runner and first application integration

Files:

- `src/lib/backtest/runner/**`
- `src/lib/backtest/index.ts`
- `src/driver/backtest.ts`
- `src/lib/dev/backtestPrecision/api/run.ts`
- `src/lib/dev/backtestPrecision/api/precision-api-types.ts`
- Backtest Precision page response types/converters

Tests:

- child process isolation;
- credential stripping;
- no live storage writes;
- no private exchange calls;
- repeated run determinism;
- open positions remain open at end;
- multi-account configured order and separate result identity;
- backend sanitized run summary logging.

Exit gate: `/dev/backtest-precision` returns real shared-engine results.

## Milestone 8 — Backtest proof and safe cleanup

Work:

- Run deterministic golden test cases through Precision Backtest.
- Compare final positions and actions with expected Precision Checker fixtures.
- Remove only backtest code proven unused by any legacy page.
- Keep legacy dynamic backtest modules if another page still imports them;
  label them non-Precision rather than deleting them prematurely.

Exit gate: the backtest-first completion criteria in Section 2.1 pass and the
production files listed at the top of this document have not been rerouted.

## Future phase — production integration through `instrumentation.ts`

This phase is deliberately not part of the current implementation. Do not
start it while implementing Milestones 0–8.

The future call chain is expected to become:

```text
src/instrumentation.ts
  -> construct production clock/market/execution/storage/effects adapters
  -> precision.runtime.create(adapterPack)
  -> start one aligned-minute production dispatcher
  -> engine.runMinute({ t })
```

The exact bootstrap may keep `getSlowTradingRunner()` as a facade or replace
it, but that choice belongs to the production migration. It must not require a
new engine API, a second stage implementation, or a second Multi plugin.

Future production work will include:

- `src/lib/precision/adapters/production/**`;
- `src/lib/slowTrading/runner.ts` dispatcher migration;
- `src/lib/slowTrading/cycle/**` delegation/removal;
- live and sandbox failure, reconciliation, and operational-effect tests;
- `PROD:RUNTIME_MISSED_CYCLE_POLICY` and
  `PROD:RUNTIME_FAILURE_ISOLATION` proof;
- a captured production case compared by the Precision Checker.

# 23. Required new tests and TC map

Use a dedicated folder such as
`src/__dev__/main/quality/precision/`. Every TC appears beside its test.

| TC | Required proof |
| --- | --- |
| `BOTH:SHARED_RUNTIME_ENGINE` | backtest invokes the environment-neutral engine; fake production-shaped adapters invoke the same public methods without production wiring |
| `BOTH:RUNTIME_INITIALIZATION` | incompatible mode/adapters are rejected |
| `BOTH:RUNTIME_LOGICAL_CLOCK` | decisions use injected logical time |
| `BOTH:RUNTIME_SCHEDULING` | due stages at 1m/5m and custom cadence |
| `BOTH:RUNTIME_DETERMINISTIC_ORDER` | stable stage/account/symbol/action order |
| `PROD:RUNTIME_MISSED_CYCLE_POLICY` | deferred: future production dispatcher logs and does not replay missed minutes |
| `BOTH:RUNTIME_STAGE_OWNERSHIP` | mutually exclusive monitoring ownership |
| `BOTH:RUNTIME_EXECUTION_CYCLE` | one full account cycle follows required steps |
| `BOTH:RUNTIME_EXIT_PRIORITY` | closed positions cannot average or exit again |
| `BOTH:RUNTIME_ACCOUNT_ISOLATION` | one account cannot mutate another |
| `BOTH:RUNTIME_SHARED_MARKET_SNAPSHOT` | public market prepared once per stage |
| `BOTH:BACKTEST_CANDLE_VISIBILITY` | no candle after logical time is visible |
| `BTEST:VPOINT_FORMATION_VISIBILITY` | point appears only after retrace confirmation |
| `BTEST:BACKTEST_MARKET_FILL` | latest completed 1m close and logical fill time |
| `BOTH:RUNTIME_ACTION_COMMIT` | successful action commits before next action |
| `PROD:RUNTIME_FAILURE_ISOLATION` | deferred: future production adapter preserves account isolation after a failure |
| `BTEST:BACKTEST_REPRODUCIBLE` | normalized results repeat exactly |
| `BTEST:BACKTEST_DATASET_CACHE` | normalized symbols/range reuse one validated dataset; refresh and concurrent-build behavior do not duplicate downloads |
| `BOTH:PLUGIN_STRATEGY` | Multi plugin has no storage/exchange effects |
| `BOTH:RUNTIME_METRICS` | calls/actions/commits/errors are measured |
| `BOTH:RUNTIME_SAFETY_GUARDS` | backtest/sandbox cannot reach live effects |
| `BTEST:BACKTEST_PROCESS_ISOLATION` | child rejects unsafe storage/env |

# 24. Known traps

The implementing agent must avoid these mistakes:

- Do not treat `kline[0]` as a candle close time. It is the open time.
- Do not let `shared-market.ts` overwrite logical time.
- Do not iterate only vPoint timestamps in backtest.
- Do not preload future completed vPoints.
- Do not execute at the historical peak price stored in a newly confirmed
  vPoint.
- Do not derive 5m candles from 1m candles.
- Do not use current market cap/funding during a historical run.
- Do not keep `executionMode: "sandbox"` on backtest positions.
- Do not force-close positions at `endTime`.
- Do not run Entry before Exit/Averaging at a common boundary.
- Do not process a Speedup position again in Standard.
- Do not fetch private balance for monitoring-only or exit-only passes.
- Do not save shared volatility inside account memory.
- Do not parallelize private account execution.
- Do not retry an uncertain live order automatically.
- Do not persist wall-clock timestamps as trading times.
- Do not compare raw results including duration fields for determinism.
- Do not log complete settings or account credentials.
- Do not add storage compatibility code for obsolete pre-launch JSON.
- Do not remove the legacy dynamic path while Quick Backtest or old pages still
  import it.

# 25. Final validation checklist

Before declaring implementation complete, verify all items:

- [ ] `npm run type` passes.
- [ ] `npm run quality` passes.
- [ ] No new lint errors or warnings were introduced.
- [ ] All new implementation and tests contain their TC comments.
- [ ] `src/lib/dev/backtestPrecision/api/run.ts` is the first application caller
      of the new engine, through the isolated child/runner path.
- [ ] `src/instrumentation.ts` and existing production orchestration remain
      unchanged in this phase.
- [ ] The engine has no production singleton, timer, storage, exchange-factory,
      notification, withdrawal, or MCP import.
- [ ] Fake production-shaped adapter tests can call the same engine API without
      changing its contracts.
- [ ] Backtest calls the extracted Multi plugin and shared trading calculation
      functions.
- [ ] Backtest has no private exchange, notification, withdrawal, or MCP call.
- [ ] Backtest storage root is isolated and guarded.
- [ ] Every returned market candle is visible at logical time.
- [ ] Streaming vPoints equal batch detector output.
- [ ] Entry/averaging use confirmation-time market price and logical time.
- [ ] Open positions remain open at backtest end.
- [ ] Account and symbol ordering is deterministic.
- [ ] State commits occur after every successful action.
- [ ] A closed position is not processed twice.
- [ ] Duplicate stage/time requests are ignored.
- [ ] Result determinism ignores only wall-duration fields.
- [ ] Golden backtest fixtures can be compared by the Precision Checker.

The following checks belong to the future production phase, not the current
backtest implementation:

- [ ] Production and backtest import the same engine module.
- [ ] Production and backtest import the same Multi plugin.
- [ ] Production and backtest call the same trading execution functions.
- [ ] A production missed minute is not replayed.
- [ ] One recorded production case can be compared by the Precision Checker.
