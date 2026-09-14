# Backtest — V1

V1 stays close to the existing volatility backtest but calls the shared runtime
and trading functions instead of keeping separate entry, averaging, and exit logic.

Reference the Multi instance's `src/lib/dynamic/backtest-volatility` and
`src/lib/devBacktest/volatility-dataset` directories.

# A. Dataset

Use one normal JSON file such as `SUI_6month.json`:

```ts
interface BacktestDataset {
  symbol: string;
  startTime: number;
  endTime: number;
  warmupKlines1m: Kline[];
  records: Array<{
    vPoint: VolatilityPoint;
    klines1mAfter: Kline[];
    klines5mAfter: Kline[];
  }>;
}
```

Each record contains candles after its vPoint until the next vPoint; the final
record continues until `endTime`. Include BTC data when the strategy uses it.
Boundaries must prevent missing or duplicated candles. Chunking is deferred.

TC: `BTEST:BACKTEST_DATASET`

# B. Time and candle visibility

Backtest moves through the historical one-minute candles without real waiting.
At each historical time, it triggers the same production stage that would be due.

A candle is visible only when production could have seen it. At 10:03, the
backtest cannot use the final values of the 10:00–10:05 candle.

The backtest must continue running one-minute and five-minute stages between
vPoints. It must not run only when a vPoint exists.

TC: `BOTH:BACKTEST_CANDLE_VISIBILITY`

# C. Shared runtime flow

The backtest supplies historical time, market data, simulated execution, and
isolated storage to the shared runtime.

Decision, entry, averaging, exit, fee, PnL, and position calculations must be
the same functions used by production. Exit runs before averaging.

TC: `BOTH:SHARED_RUNTIME_ENGINE`

# D. Simulated execution

V1 uses the current simple execution approach:

- Fill a market action from the current visible historical price.
- Apply the configured trading fee.
- Apply the same quantity, leverage, margin, and rounding calculations as production.
- Record expected price, fill price, quantity, fee, request time, fill time, and status.

Advanced fill and latency models are deferred. Slippage may be a simple setting.

# E. Initial and final state

A backtest starts with explicit balance, positions, orders, strategy state,
configuration, and a random seed when needed.

For production comparison, open positions remain open at `endTime`. A forced
final sale is allowed for tuning reports only when clearly selected and labeled.

# F. Result

Keep the current `BacktestReturnDynamic` result as the base. Add only the fields
needed by the Precision Checker:

- Start and end time
- Effective configuration and initial state
- Trade history with entry, averaging, and exit executions
- Final balance, open positions, fees, and PnL
- Whether open positions were kept or force-closed

# G. V1 tests

- No future one-minute or five-minute candle is visible.
- Historical stages use the production cadence.
- Backtest and production call the same trading functions.
- Exit runs before averaging.
- Repeating the same run produces the same result.
- Backtest cannot submit a real order or write live storage.
