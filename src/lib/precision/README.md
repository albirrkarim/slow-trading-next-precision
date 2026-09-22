# Precision Runtime Engine

`RuntimeEngine` is the shared coordinator for backtest, sandbox, and live
trading. The engine always follows the same scheduling path. The injected
adapter decides how time advances, where market data comes from, and how an
action is performed.

This directory currently provides the clock loop, monitoring schedule, and
shared entry-decision pipeline. Position monitoring in
`monitoring/position.ts` and the stage handlers in `monitoring/stages.ts` still
need to be connected to the shared trading functions.

## Directory structure

```text
precision/
  index.ts                 Public surface: re-exports RuntimeEngine and types
  RuntimeEngine.ts         Shared engine: clock loop and stage orchestration
  types.ts                 State, adapter, clock, and context contracts
  constant.ts              Engine constants (lookbacks, retention defaults)
  defaultDecision/         Shared decisions backed by production algorithms
  helper/                  State-bound account/config/balance/market helpers
  utils/                   Stateless pure utilities shared by engine and adapters
  action/                  Environment action implementations (e.g. simulated)
  monitoring/
    index.ts               Grouped monitoring API
    schedule.ts            Stage timing and Speedup activation
    stages.ts              Standard and Speedup stage handlers
    position.ts            Position monitoring, averaging, and exit
    entry.ts               Entry capture
```

## `helper/` vs `utils/`

Both folders hold engine implementation details; the difference is binding:

- `helper/` — **state-bound operations**. `createRuntimeHelper(state, adapter)`
  is called once per `RuntimeEngine` and returns functions that read and mutate
  that engine's state and call its adapter (`getAccount`, `getAccountBalance`,
  `getAccountConfig`, `market.updateMarkPrice`, `market.updateVPointsMap`).
  They are exposed to monitoring code through `context.helper`.
- `utils/` — **stateless pure functions**. They take explicit inputs and
  return outputs with no engine state or adapter (`vpoints.retainRecent`,
  `vpoints.mergeById`). They are importable by the engine, by environment
  adapters (production persistence, backtest result assembly), and by dev
  tooling alike.

Rule of thumb: if the operation needs `state` or `adapter`, it belongs in
`helper/`; if it only needs its own arguments, it belongs in `utils/`.

Callers import the engine as one public boundary:

```ts
import { RuntimeEngine } from "@/lib/precision";
```

## Shared lifecycle

The lifecycle is identical in every environment:

```text
RuntimeEngine.start()
  -> schedule calculates the next useful stage boundary
  -> adapter.clock advances or waits for that boundary
  -> state.currentTime is updated from adapter.clock.now()
  -> due monitoring stages run in order
  -> repeat until adapter.clock.finished() returns true
```

The current stage order is:

1. Speedup monitoring, only when an open position was classified as Speedup.
2. Standard monitoring.
3. Capture Entry.

Intervals come from `state.config.runtime`. When there is no Speedup position,
the scheduler does not create extra Speedup boundaries.

## Engine state

Both backtest and production construct the same state shape:

```ts
const state: RuntimeEngineState = {
  balance: balanceByAccountSlug,
  config,
  currentTime,
  mode: "backtest", // or "sandbox" / "live"
  openPositions,
};
```

`currentTime` is the engine's canonical time. Decisions, visible candles,
execution timestamps, and state updates for one cycle must all use this value.

## Adapter contract

Every environment must provide all adapter capabilities:

```ts
const adapter: RuntimeEngineAdapter = {
  clock,
  market,
  exchange,
  onStrategy,
  onAction,
  onExit,
  onNotif,
};
```

| Capability | Backtest | Production |
| --- | --- | --- |
| `clock` | Advances immediately through historical time | Waits for real UTC boundaries |
| `market` | Reads cached historical klines | Reads current exchange klines |
| `exchange` | Usually empty or simulated | Exposes production exchange operations |
| `onStrategy` | Shared strategy | The same shared strategy |
| `onAction` | Simulates an accepted action | Submits sandbox or live execution |
| `onExit` | Collects closed backtest history | Persists closed-position history |
| `onStateChange` | Usually omitted | Persists account state and vPoint usage markers |
| `onNewVPoint` | Buffers detected points for the full result map | Merges each point into shared volatility files |
| `retainRecentVPoints` | Unset — same window as production | Unset — default `DEFAULT_RECENT_VPOINTS` |
| `onNotif` | Disabled/no-op | Delivers configured notifications |

The environment adapter supplies capabilities. It must not contain a second
copy of the strategy rules.

## Backtest usage

Backtest time is finite and advances without waiting. Start from the requested
time or the first available candle, then stop at the last close boundary shared
by every required one-minute series.

```ts
import { RuntimeEngine } from "@/lib/precision";
import type {
  RuntimeEngineAdapter,
  RuntimeEngineState,
} from "@/lib/precision/types";

const dataset = await preparePrecisionDataset(params);
const currentTime = dataset.startTime + windowsMs["1m"] * 2;
const vPointsMap = await createInitialVPointsMap(
  dataset.symbols,
  dataset.getKlines,
  dataset.startTime,
  currentTime,
);

const state: RuntimeEngineState = {
  balance: createInitialBalance(params),
  config: params.config,
  currentTime,
  markPriceMap: {},
  mode: "backtest",
  openPositions: [],
  vPointsMap,
};

let logicalTime = state.currentTime;

const adapter: RuntimeEngineAdapter = {
  clock: {
    advanceTo(nextTime) {
      logicalTime = Math.min(nextTime, dataset.endTime);
    },
    finished() {
      return logicalTime >= dataset.endTime;
    },
    now() {
      return logicalTime;
    },
  },
  market: {
    getKlines: dataset.getKlines,
  },
  exchange: {},
  onStrategy: async () => true,
  onAction: async (decision, context) =>
    simulateAction(decision, context),
  onExit: async (position) => {
    history.push(position);
  },
  onNotif: () => true,
};

const engine = new RuntimeEngine(state, adapter);
await engine.start();
```

### Backtest requirements

- The clock must never use `Date.now()` after initialization.
- `advanceTo()` must not sleep.
- `finished()` must eventually return `true`.
- The end time must not exceed the common dataset coverage.
- Market reads must expose only candles completed by `state.currentTime`.
- Simulated fills must use information visible at `state.currentTime`.
- Backtest must not submit real exchange orders or deliver notifications.

The backtest downloads only one-minute candles into compact daily files under
`storage/datasets/PRECISION_BACKTEST/1m/<symbol>/`. The adapter keeps only a
bounded set of current day files in memory and derives complete UTC-aligned
five-minute candles locally. It never exposes a candle whose close is later
than the logical clock.

## Production usage

Production uses the same engine, but its clock waits for wall-clock time and
its market capability reads from the configured exchange.

```ts
import { RuntimeEngine } from "@/lib/precision";
import type {
  RuntimeClock,
  RuntimeEngineAdapter,
  RuntimeEngineState,
} from "@/lib/precision/types";

function createProductionClock(signal: AbortSignal): RuntimeClock {
  let currentTime = Date.now();

  return {
    async advanceTo(nextTime) {
      const delayMs = Math.max(0, nextTime - Date.now());

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(resolve, delayMs);
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timeout);
            reject(new DOMException("Runtime stopped", "AbortError"));
          },
          { once: true },
        );
      });

      currentTime = nextTime;
    },
    finished() {
      return signal.aborted;
    },
    now() {
      return currentTime;
    },
  };
}

const state: RuntimeEngineState = {
  balance: loadedBalanceByAccountSlug,
  config: loadedSettings,
  currentTime: Date.now(),
  mode: "live",
  openPositions: loadedOpenPositions,
};

const adapter: RuntimeEngineAdapter = {
  clock: createProductionClock(shutdownController.signal),
  market: {
    getKlines: (request) => exchange.getKlines(request),
  },
  exchange: {
    getBalance: () => latestCachedBalance,
  },
  onStrategy: async (decision, context) =>
    approveStrategy(decision, context),
  onAction: async (decision, context) =>
    executeLiveAction(decision, context),
  onExit: async (position, context) =>
    persistClosedPosition(position, context),
  onNotif: () => true,
};

const engine = new RuntimeEngine(state, adapter);
await engine.start();
```

### Production requirements

- Initialize state from persisted production data before starting the engine.
- The clock must wait until the requested boundary rather than advancing early.
- A missed cycle should not replay old orders automatically.
- Market reads use the exchange configured for the account and trading mode.
- Live execution must return verified exchange facts before state is updated.
- Shutdown must stop the clock loop cleanly.
- Configuration changes can later be applied through `updateConfig()`.

Sandbox uses the production clock and live market data, but `onAction` simulates
execution instead of submitting a real order.

## Implementing monitoring

Monitoring receives a `RuntimeContext` containing the same state and adapter in
every environment:

```ts
interface RuntimeContext {
  adapter: RuntimeEngineAdapter;
  helper: RuntimeHelper;
  state: RuntimeEngineState;
}
```

The engine registers the helper pack once. Monitoring code can access account
data without repeating state traversal:

```ts
const accountConfig = context.helper.getAccountConfig(position.account);
const accountBalance = context.helper.getAccountBalance(position.account);

accountBalance.available -= usedMarginUSDT;
```

The returned balance is the same mutable object stored in
`context.state.balance`. Helper implementations live under `helper/`, keeping
the main engine class focused on orchestration.

Implementation belongs in the grouped monitoring modules:

```ts
monitoring.stages.speedup(context);
monitoring.stages.standard(context);
monitoring.entry.capture(context);
monitoring.position.monitor(context);
monitoring.position.exit(context);
monitoring.position.averaging(context);
```

Those functions should contain shared decision and accounting behavior. They
must not branch on `backtest` versus `live` to choose data or execution. Call
the injected adapter instead:

```ts
const klines = await context.adapter.market.getKlines(request);
const decisions = await defaultDecision.entry.find(context);
for (const decision of decisions) {
  const approved = await context.adapter.onStrategy(decision, context);
  if (!approved) continue;

  const position = await context.adapter.onAction(decision, context);
  if (!position) continue;

  context.state.openPositions.push(position);
}
```

`onAction` returns a canonical `Position` only after execution succeeds. The
shared entry monitor then records that position, updates the account balance,
and marks the source vPoint as used for that account. Simulated and live
adapters must therefore return the same position shape.

## What stays shared and what changes

Shared between environments:

- Stage scheduling and ordering
- Position eligibility
- Strategy decisions
- Exit-before-averaging priority
- Entry, averaging, exit, PnL, fee, and balance calculations
- Position state transitions

Environment-specific:

- How time advances
- Where market data comes from
- How an accepted action is filled
- Where state is persisted
- Whether notifications are delivered

Select the environment when constructing the adapter. Avoid scattering
`if (state.mode === "backtest")` throughout monitoring and trading logic.

## Checklist for a new adapter

1. Construct a complete `RuntimeEngineState`.
2. Provide a clock that advances or waits and eventually reports completion.
3. Provide market data that respects `state.currentTime`.
4. Provide strategy and action callbacks.
5. Disable external side effects when running a backtest.
6. Construct `RuntimeEngine` with the state and adapter.
7. Call and await `engine.start()`.
