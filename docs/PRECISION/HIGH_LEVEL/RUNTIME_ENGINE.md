# Shared Runtime Engine — V1

Extract the common path from Multi's `src/lib/slowTrading` and `src/lib/trading`.
Do not create an event framework or redesign strategy rules.

the engine will be on `src/lib/precision/*`

# 0. Notes from users

correct me if im wrong, i just figuring out.

i think the runtime engine will be have initialization. its a backtest or production.

**BACKTEST**
when it is backtest so we dont doing delay on the interval of the Stages like speedup etc.

we will keep increment every 5 minutes go on. when it has some position is on the speedup, so we firing rate one minute. of that specific position.

i think we have central clock. so that clock will be runing and changing from the start to the end of the backtest.

central clock will be feed into the market.getKlines function

so the time incremental flow is maybe something like this

5minuteA -> 1minuteB1 -> 1minuteB2 -> -> 1minuteB3 -> 1minuteB4 -> 5minuteB

because in the middle we have speedup stage that require 1 minute getting, other wise it will goes increment up 5minutes again and again. to the end of the backtest.

**PRODUCTION (LIVE/SANDBOX)**

when it is production so no need central clock

# A. Goal

Live, sandbox, and backtest call the same functions for decisions, entry,
averaging, exit, accounting, and position updates.

TC: `BOTH:SHARED_RUNTIME_ENGINE`

# B. Dependencies

```ts
interface RuntimeEngineInput {
  mode: "live" | "sandbox" | "backtest";
  clock: RuntimeClock;
  market: MarketSource;
  execution: ExecutionSource;
  storage: RuntimeStorage;
  strategy: StrategyPlugin;
  config: RuntimeConfig;
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

- `clock` supplies the logical Unix-millisecond time.
- `market` returns only data visible at that time and fails when data is missing.
- `execution` submits live orders or performs deterministic simulated fills.
- `storage` loads and atomically saves state isolated by mode and account.
- `strategy` returns decisions and never accesses exchange or storage directly.

Implement these contracts as grouped APIs and reuse current types where possible.

# C. Stages and ordering

| Order | Stage               | Default cadence |
| ----- | ------------------- | --------------- |
| 1     | Risk Sentinel       | 1 minute        |
| 2     | Speedup             | 1 minute        |
| 3     | Standard Monitoring | 5 minutes       |
| 4     | Management          | 5 minutes       |
| 5     | Capture Entry       | 5 minutes       |

At each logical one-minute close, a stage is due when the UTC epoch-minute is
divisible by its interval. Run due stages in table order, accounts by configured
order, and symbols alphabetically. A mode processes one cycle at a time;
duplicate stage/time requests are ignored. A missed production cycle is logged
and skipped, not silently replayed.

Backtest uses the same stage eligibility and ordering without real waiting.

TC: `BOTH:RUNTIME_SCHEDULING`

# D. Trading flow

For each eligible account and symbol:

1. Load configuration and account state.
2. Load the market snapshot for logical time.
3. Ask the selected strategy for a decision.
4. Apply risk or forced exit, then normal exit.
5. Average only if the position remains open.
6. Enter only if no position blocks entry.
7. Execute through the selected adapter.
8. Apply shared quantity, fee, PnL, and position calculations.
9. Save state before processing the next action for that position.

A position closed in this cycle cannot be processed again.

TC: `BOTH:RUNTIME_EXECUTION_CYCLE`

# E. Strategies and accounts

Multi, Hedge, and Streak use one strategy contract with their own configuration,
state, market requirements, and decisions. Public market snapshots may be shared;
balances, positions, execution, and storage remain account-specific.

TC: `BOTH:PLUGIN_STRATEGY`

# F. Safety and tests

- Backtest and sandbox cannot submit real orders or write live state.
- Live order submission preserves existing idempotency and recovery behavior.
- All modes expose the canonical final position shape.
- Tests cover stage order, cadence, account/symbol order, exit priority, mode
  isolation, missing market data, and repeated backtest results.

Generic event envelopes and a new persistence architecture are not part of V1.
