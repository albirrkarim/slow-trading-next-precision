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

I think of js class like this

```ts


class RuntimeEngine {
  state = {
    currentTime,// global clock

    mode // live, sandbox, backtest
    openPositions = []

    config
    balance

    // other state that need be accessed fast in memory without digging from storage
  }

  adapter = {
  market,


  /**
   * we pass the exchange lib so it can later be tested outside
   * does it really called the update balance after doing some action
   */
  exchange,

  /**
   * with the strategy outside we can doing manythings
   * adapt to our 3 instance.
   *
   */
  onStrategy,

  onAction,

  onNotif
  }

  constructor({ config, market, exchange,onStrategy, onAction, onNotif}){
    this.onStrategy = onStrategy
    this.onAction = onAction
    this.onNotif = onNotif
    this.config = config;
  }

  start(){
    // start the runtime engine
  }

  standardStages(){

    // for each position that lastmonitoredis = standard

    // do monitoring
    this.monitoring

    // also check criterion so the position might moved to speedup stages
  }

  speedupStages(){

    // for each position that lastmonitoredis = speedup

    // do monitoring
    this.monitoring


    // also check criterion so the position might moved to standard stages
  }

  monitoring(){
    // Shared market data. the latest price etc..
    // then the data Consumed by
    this.averaging(data)
    this.exit(data)

    this.updateBalance
  }


  captureEntry(){
    // trying to entry

    // updating the volatility points

    // on strategy feeded with the latest volatility points
    const decision = await this.onStrategy(this.state,vpointsMap)

    // maybe the decision
    // const result = await this.onAction()
  }

  averaging(){
    // trying to do averaging

    // telling outside todo something, maybe real execution etc
    const result = await this.onAction()
    // from the result we record back to internal runtime engine stage
    // is success?
    // is it changing the position data
    // is it closed the position

    // is it live mode?
    // if yes we need to call exchange update balance
    // if not we do the calculation to update the balance with the current trade result.
  }

  exit(){
    // trying to do exit from the open position

    // using the config and the exit rules/ conditions we decide the exit.

    // telling outside todo something, maybe real execution etc
    const result = await this.onAction()
    // from the result we record back to internal runtime engine stage
    // is success?
    // is it changing the position data
    // is it closed the position

    // is it live mode?
    // if yes we need to call exchange update balance
    // if not we do the calculation to update the balance with the current trade result.
  }

  updateBalance(){

    // foreach accounts
    const balanceAccount = this.exchange.getBalance
  }

  // used in production
  updateConfig(){
    // update config to the state and storage
  }
}



// A. Backtest
/**
 * we can measure the api execution time with this function
 * from begin to the end
 *
 * With this function in the backtest adapter
 * we can doing simulate the slipage or late execution because of the api
*/
const onAction = async (currentTime:number, type: "entry" |"averaging" | "exit" ,params)=>{
  //
  //

  // entry

  // averaging

  // exit


  // return the actual data to the runtime engine,
  // the actual price that we got.
  // so it later will update the data on the this.state.openPosition
  return {position}
}


klinesMap[symbol]= klines from cache
//
const market = {
  getKlines: (currentTime,otherParams)=>{
      return fetchKlines({
        klines: klinesMap[otherParams.symbol] // inject the klines[] into the function so it doesnt make request to outside
   })
  }
}


// Later we can use onNotif as the test.
const onNotif=(params)=>{
  notif.send(params)
}


// so it will be something like this Same Runtime engine, diferent environment adapter
const backtestRuntime = new RuntimeEngine({
  config,
  market,
  onAction,
  onNotif
})

backtestRuntime.start()



async function initiateProductionRuntime(){

// load up config from storage
// load up balance

const productionRuntime = new RuntimeEngine({
  config,
  market,
  onAction,
  onNotif
})

productionRuntime.start()
}
```
