# Shared Runtime Engine — V1

The runtime engine is the **brain** of Precision. It receives market data,
strategies, configuration, and account state, then coordinates when each stage
runs and which trading actions should happen.

The environment adapter is its **hands**. The engine asks it to get data,
execute entry, averaging, or exit, save state, and optionally deliver
notifications. The adapter performs that work and returns the result to the
engine.

There is one runtime engine and two environment adapters:

- **Backtest adapter:** historical data, simulated time, simulated execution,
  and isolated backtest storage.
- **Production adapter:** current market data, real time, production storage,
  and live or sandbox execution.

Live and sandbox are modes of the production adapter. They do not have separate
runtime brains.

This is the target architecture. As described in [BACKTEST.md](BACKTEST.md),
backtest adopts the shared runtime first; production wiring follows later.
The engine belongs under `src/lib/precision/*`. The older runtime location in
[FOLDER.md](FOLDER.md) needs to be aligned when the folder plan is revised.

# A. Goal

Given the same visible data, strategy, configuration, and starting state,
backtest and production follow the same scheduling, decisions, entry,
averaging, exit, accounting, and position-update rules. Differences belong in
the environment adapters, such as historical versus current data and simulated
versus actual fills.

V1 reuses Multi's proven behavior from `src/lib/slowTrading` and
`src/lib/trading`. It does not redesign strategy rules or introduce an event
framework. Multi is the V1 strategy; Hedge and Streak follow in V2.

TC: `BOTH:SHARED_RUNTIME_ENGINE`

# B. Inputs and responsibilities

| Part                | Responsibility                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Strategy            | Interpret the supplied market data and position state and return trading decisions.                                                               |
| Configuration       | Supply accounts, symbols, strategy settings, risk settings, and stage intervals.                                                                  |
| Runtime engine      | Arrange stage timing, select eligible positions, apply action priority, coordinate execution, and update state using shared trading calculations. |
| Environment adapter | Supply time and market data, carry out execution, load/save state, and handle environment-specific output.                                        |

The engine is initialized with the selected adapter, strategy, configuration,
and starting state. These dependencies remain fixed to the selected environment
for that run. Each account keeps its own balances, positions, and settings.
Public market data may be shared across accounts when the request and visible
time are the same.

The strategy does not call the exchange or storage directly. The adapter does
not decide when to enter, average, or exit. Those decisions remain in the shared
runtime and strategy path.

Entry, averaging, exit, quantity, fee, PnL, and position calculations reuse the
shared trading functions. The adapter returns execution facts, such as filled
quantity, price, fees, and execution time; it does not maintain a second copy of
trading rules.

TC: `BOTH:PLUGIN_STRATEGY`

# C. Two adapters, one shared path

| Capability    | Backtest adapter                                                                            | Production adapter                                                           |
| ------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Time          | Advance a central logical clock from the start to the end of the run, without real waiting. | Supply real time and wake the engine at the required stage boundaries.       |
| Market data   | Read the dataset, exposing only candles completed by the logical time.                      | Read current exchange market data through the existing exchange library.     |
| Execution     | Simulate fills using the rules in `BACKTEST.md`.                                            | Submit real orders in live mode or simulate execution in sandbox mode.       |
| Storage       | Read and write isolated run state and results.                                              | Read and write persistent state isolated by account and live/sandbox mode.   |
| Notifications | Disable external delivery; retain relevant information in run output.                       | Deliver configured notifications through the existing notification channels. |

These are capabilities of each environment adapter, not five independent
runtime engines. Implement them as grouped APIs and reuse existing types and
libraries where possible.

Notifications are optional output. The engine identifies what happened; the
adapter handles delivery. Notification delivery must not determine the next
trading decision or cause an order to be executed again.

# D. The brain arranges timing

The engine owns the schedule: which stages are due, their order, and which
accounts and positions are eligible. The adapter supplies the current time
and the mechanism for reaching the next tick.

| Order | Stage               | Default cadence |
| ----- | ------------------- | --------------- |
| 1     | Risk Sentinel       | 1 minute        |
| 2     | Speedup             | 1 minute        |
| 3     | Standard Monitoring | 5 minutes       |
| 4     | Management          | 5 minutes       |
| 5     | Capture Entry       | 5 minutes       |

At each logical one-minute close, a stage is due when the UTC epoch-minute is
divisible by its configured interval. Run due stages in table order, accounts
in configured order, and symbols alphabetically. Process one cycle at a time
per mode, and ignore duplicate stage/time requests. A missed production cycle
is logged and skipped, not silently replayed.

Speedup checks only positions eligible for Speedup. Standard Monitoring handles
other open positions. Capture Entry handles eligible symbols without an open
position. Management maintains the configured symbol universe and does not
perform entry, averaging, or exit. Existing risk and stage-eligibility rules
remain shared across both adapters.

For example, a position promoted to Speedup after the 10:00 monitoring pass can
be checked at 10:01, 10:02, 10:03, and 10:04. At 10:05, all due stages run in
order. Other positions do not become Speedup positions just because one position
needs one-minute monitoring.

## Backtest time

Backtest has a central logical clock. The same logical time is used for market
visibility, decisions, execution, and state updates. Market requests, including
`market.getKlines`, must respect that clock: at time `t`, only candles with
`closeT <= t` are visible. A missing required candle fails the run clearly.

The clock advances through one-minute closes without sleeping, as defined in
`BACKTEST.md`. Five-minute trading stages still run only when due. Therefore,
the useful trading work may look like five-minute steps with one-minute Speedup
checks between them, but the clock must not skip required Risk Sentinel or other
one-minute work. Skipping minutes is not part of V1.

vPoints become available only when the existing detector confirms them from
visible candles, including the required retrace. The runtime must not average
at an earlier peak merely because the finished dataset reveals that peak.

## Production time

Production does not manually advance a simulated central clock. It uses real
time through the same clock capability and waits for the next due boundary.
The runtime therefore uses the same scheduling rules in both environments;
only how time advances is different.

TC: `BOTH:RUNTIME_SCHEDULING`
TC: `BOTH:BACKTEST_CANDLE_VISIBILITY`

# E. Trading cycle

For each due trading stage and eligible account/symbol:

1. Load the current configuration and account state, and confirm eligibility.
2. Obtain the market data visible at the cycle's time through the adapter.
3. Ask the selected strategy for a decision using that data and state.
4. Apply risk or forced exit first, then normal exit.
5. Consider averaging only if the position remains open.
6. Consider entry only if no position blocks entry.
7. Ask the adapter to execute the selected action and return its result.
8. Apply shared accounting and position updates from the execution result.
9. Save state before processing the next action for that position.

A position closed in this cycle cannot be processed again. A failed or uncertain
execution must not be recorded as a successful fill. Production preserves the
existing order-idempotency and recovery behavior.

The adapter performs the requested action; control returns to the engine to
coordinate what happens next.

TC: `BOTH:RUNTIME_EXECUTION_CYCLE`

# F. Safety and verification

- Backtest and sandbox cannot submit real orders or write live state.
- Backtest never resolves the global production exchange factory or sends
  external notifications.
- All modes expose the same canonical final position shape for the Precision
  Checker. Backtest does not force-close positions at the end of a run.
- Repeating a backtest with identical inputs produces the same trading result.
- Tests cover stage cadence and ordering, position eligibility, account/symbol
  order, exit priority, execution-result handling, mode isolation, missing data,
  candle visibility, and reproducible backtest results.

This document defines the shared orchestration boundary. Detailed dataset and
fill rules remain in [BACKTEST.md](BACKTEST.md), and result comparison remains
in [PRECISION_CHECKER.md](PRECISION_CHECKER.md).

# G. Class design sketch

The engine keeps frequently used state in memory and receives its dependencies
through the constructor. The same class is initialized with either the backtest
adapter or the production adapter.

This is a conceptual TypeScript sketch. Types and helper functions illustrate
responsibilities; their implementations will reuse the existing trading code.
`onAction` performs execution and returns execution facts. The engine applies
those facts to its state. `onNotif` is an optional output hook.

```ts
class RuntimeEngine {
  state: RuntimeState;

  constructor(
    private readonly dependencies: {
      initialState: RuntimeState;
      clock: RuntimeClock;
      market: MarketSource;
      exchange: ExchangeSource;
      storage: RuntimeStorage;
      onStrategy: StrategyHandler;
      onAction: ActionHandler;
      onNotif?: NotificationHandler;
    },
  ) {
    this.state = dependencies.initialState;
  }

  // State includes currentTime, mode, config, and account-specific balances
  // and open positions, plus other frequently accessed runtime data.

  async start() {
    // Load or restore state.
    // Advance through logical ticks in backtest, or wait for real-time ticks
    // in production, using the injected clock.
    // Run due stages in the order defined in Section D.
  }

  async standardStage() {
    // Monitor positions currently eligible for Standard Monitoring.
    // Re-evaluate whether each position belongs in Speedup on the next pass.
  }

  async speedupStage() {
    // Monitor positions currently eligible for Speedup.
    // Return a position to Standard when no Speedup criteria remain true.
  }

  async monitoring(context: MonitoringContext) {
    // Context contains the account, position, and shared visible market data.
    // Risk and forced exits take priority over normal exit and averaging.
    await this.exit(context);

    if (!context.position.closed) {
      await this.averaging(context);
    }

    // Each successful action updates and saves state before the next action.
  }

  async captureEntry() {
    // Refresh volatility points using only currently visible market data.
    // Feed state and the latest vPoints into dependencies.onStrategy.
    // For an eligible entry decision, execute through dependencies.onAction.
    // Apply the result, update the account balance, and save state.
  }

  async averaging(context: MonitoringContext) {
    // Evaluate averaging rules using the current position and strategy.
    // If eligible, await dependencies.onAction with the action parameters.
    // Apply the confirmed execution result to the position.
    // Update the account balance and save state before any next action.
  }

  async exit(context: MonitoringContext) {
    // Evaluate risk, forced-exit, and normal-exit rules in priority order.
    // If eligible, await dependencies.onAction with the action parameters.
    // Apply the confirmed execution result, including whether it closed
    // the position, then update the account balance and save state.
  }

  async updateBalance(accountId: string) {
    // Use the injected exchange/account capability for the selected account.
    // Live mode reconciles with the actual exchange balance.
    // Sandbox and backtest expose balances calculated from simulated fills.
    // Keep environment-specific balance handling inside the adapter.
  }

  async updateConfig(config: RuntimeConfig) {
    // Validate and persist configuration changes, then update in-memory state
    // at a safe cycle boundary. Production can call this while running.
  }
}
```

## Backtest adapter example

The adapter serves cached klines filtered by logical time and returns simulated
execution facts. Execution duration can be measured here. V1 supports the
deterministic slippage described in `BACKTEST.md`; simulated execution latency
is a possible later extension.

```ts
const backtestAdapter = {
  clock: backtestClock,
  exchange: simulatedExchange,
  storage: isolatedStorage,

  market: {
    async getKlines(currentTime: number, params: KlineRequest) {
      // Cache entries are separated by symbol and candle interval.
      const klines = klinesMap[params.symbol][params.interval];

      return fetchKlines({
        ...params,
        currentTime,
        klines, // Inject cached candles instead of making a network request.
      });
      // fetchKlines must expose only candles with closeT <= currentTime.
    },
  },

  async onAction(action: TradingAction): Promise<ExecutionResult> {
    // Handle entry, averaging, or exit at the current logical time.
    // Return actual simulated fill price, quantity, fees, and execution time.
    // The engine uses this result to update its positions and accounting.
    return simulatedExecution.execute(action);
  },

  async onNotif(notification: RuntimeNotification) {
    // Record locally for inspection or assertions; do not send externally.
    await backtestOutput.recordNotification(notification);
  },
};

const backtestRuntime = new RuntimeEngine({
  ...backtestAdapter,
  initialState: backtestInitialState,
  onStrategy: multiStrategy.decide,
});

await backtestRuntime.start();
```

## Production adapter example

Production injects real-time scheduling and the existing exchange, storage,
and notification libraries. Startup loads the saved configuration first and
uses its active live or sandbox mode to select execution, balance handling,
and the account state to restore. The caller does not pass a mode.

```ts
async function initiateProductionRuntime() {
  const config = await productionStorage.config.load();
  const mode = config.activeMode;
  const productionAdapter = createProductionAdapter({ mode, config });

  // Restore configuration, account balances, and positions for this mode.
  const initialState = await productionAdapter.storage.load();

  const productionRuntime = new RuntimeEngine({
    ...productionAdapter,
    initialState,
    onStrategy: multiStrategy.decide,
  });

  await productionRuntime.start();
}
```
