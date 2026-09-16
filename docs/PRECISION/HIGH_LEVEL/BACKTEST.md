# Backtest — V1

Backtest runs through the shared production runtime in an isolated child
process (`src/driver/backtest.ts`): a dataset-backed exchange adapter, a
logical clock, and an isolated `PERSISTENT_STORAGE_ROOT`.

# A. Dataset

One normal JSON file stored under `storage/backtest-dataset`:

```ts
interface BacktestDatasetV1 {
  schema: 1;
  sourceExchangeType: ExchangeType;
  marketType: "SPOT" | "FUTURES";
  warmupStartTime: number;
  startTime: number;
  endTime: number;
  symbols: string[]; // always includes BTC
  klines: Record<string, { "1m": Kline[]; "5m": Kline[] }>;
}
```

Klines are raw per-symbol one-minute and five-minute candles kept as
independent series; five-minute candles are never derived from one-minute
candles. vPoint formation is reconstructed during the run by the copied
`detectVolatilityPoints` function over exactly the candles visible at each
logical time, so the production retrace-then-mark-peak timing is reproduced
without reinventing detection. Reject gaps, duplicate candle times, reversed
ranges, or missing coverage.

TC: `BTEST:BACKTEST_DATASET`

# B. Logical time and visibility

Start from `initialState` at `startTime`. One logical runtime tick occurs at
each one-minute candle close after `startTime` through `endTime`. At time `t`,
only candles with `closeT <= t` are visible; requests that predate the dataset
fail the run with a clear error. The shared volatility memory captured with
the test case seeds the vPoint-detection starting state.

TC: `BOTH:BACKTEST_CANDLE_VISIBILITY`

# C. Shared runtime

Every tick invokes the due production stages using the cadence and ordering
in `RUNTIME_ENGINE.md` (risk sentinel, speedup, standard monitoring,
management, capture entry). Decisions, entry, averaging, exit, quantity, fee,
PnL, and position calculations are the same functions used by production,
resolved through the shared exchange factory.

TC: `BOTH:SHARED_RUNTIME_ENGINE`

# D. Simulated execution

V1 fills an accepted market action at the close of the latest visible
completed one-minute candle. Fill time is the current logical time. Optional
configured slippage adjusts the fill price deterministically. There is no
random latency, partial fill, rejection, or order-book model.

TC: `BTEST:BACKTEST_MARKET_FILL`

# E. End state and result

Positions are not force-closed. `endPositions` contains the final form of
every position present at start or created before `endTime`, including
positions closed during the run. The result extends `PrecisionRunV1` with
measurable `metrics` (API calls, durations, stage executions, fills, errors,
retries, rate-limit usage) and is written to `storage backtest-result`
atomically. Repeating the same run produces the same result.

TC: `BTEST:BACKTEST_REPRODUCIBLE`
TC: `BTEST:BACKTEST_METRICS`

# F. Safety

- The driver refuses to run unless `PERSISTENT_STORAGE_ROOT` points at an
  isolated temp directory, so a backtest can never read or write production
  live/sandbox storage.
- The driver deletes notification credentials from its environment and the
  seeded runtime disables every notification channel.
- Withdrawals are rejected by the dataset-backed adapter.
