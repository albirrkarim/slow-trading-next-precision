# Backtest — V1

Stay close to Multi's `src/lib/dynamic/backtest-volatility` and volatility
dataset tooling, but call the shared runtime and trading functions.

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

Records are chronological. Each contains one vPoint and the one-minute candles
and five-minute candles after it until the next vPoint; the final record
continues through `endTime`. Include BTC candles when the strategy uses BTC
context. Reject gaps, duplicate candle times, reversed ranges, or missing data.

TC: `BTEST:BACKTEST_DATASET`

# B. Logical time and visibility

Start from `initialState` at `startTime`. Process candles whose close time is
greater than `startTime` and less than or equal to `endTime`, in ascending order.
One logical runtime tick occurs at each one-minute candle close.

At time `t`, expose only one-minute and five-minute candles with `closeT <= t`.
Use `klines1mAfter` and `klines5mAfter` as independent source data. Do not create
or replace five-minute candles by aggregating the one-minute candles.

A vPoint becomes visible only at its recorded confirmation time. Missing data
fails the run; backtest never fetches replacements or searches forward.

TC: `BOTH:BACKTEST_CANDLE_VISIBILITY`

# C. Shared runtime

Every tick invokes the due production stages using the cadence and ordering in
`RUNTIME_ENGINE.md`. Stages continue between vPoints.

Decision, entry, averaging, exit, quantity, fee, PnL, and position calculations
are the same functions used by production.

TC: `BOTH:SHARED_RUNTIME_ENGINE`

# D. Simulated execution

V1 fills an accepted market action at the close of the latest visible completed
one-minute candle. Fill time is the current logical time. Apply production
quantity precision, rounding, leverage, margin, and the configured fee.

V1 has no random latency, partial fills, rejection model, or order-book model.
Optional configured slippage adjusts the fill price deterministically.

# E. End state and result

Do not force-close positions for Precision Checker runs. `endPositions` contains
the final form of every position present at start or created before `endTime`,
including positions closed during the run.

Extend the current result rather than replacing it:

- `schema: 1`, `strategy`, and `mode: "backtest"`
- Start/end time, effective configuration, and initial state
- Existing trade history for the backtest dashboard
- Canonical `endPositions`, final balance, fees, and PnL
- Whether a non-checker run explicitly force-closed open positions

# F. Tests

- No future one-minute or five-minute value is visible.
- Dataset boundaries contain no missing or duplicate candles in either interval.
- Runtime cadence and ordering match production.
- Fill price and time follow the rule above.
- Repeating the same run produces the same result.
- Backtest cannot submit a real order or write live or sandbox storage.
