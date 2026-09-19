# Backtest — V1

Backtest runs through the environment-neutral Precision runtime in an isolated
child process (`src/driver/backtest.ts`): a dataset-backed exchange adapter, a
logical clock, and an isolated `PERSISTENT_STORAGE_ROOT`. Production will adopt
the same runtime in a later phase; it is not wired during backtest-first work.

# A. Dataset

The dataset is a small manifest. It references separately cached kline files;
it never embeds all candle arrays in one JSON object:

```ts
interface BacktestDatasetManifestV1 {
  schema: 1;
  fingerprint: string;
  sourceExchangeType: ExchangeType;
  marketType: "SPOT" | "FUTURES";
  warmupStartTime: number;
  startTime: number;
  endTime: number;
  symbols: string[]; // always includes BTC
  series: Record<
    string,
    {
      "1m": BacktestKlineSeriesRef;
      "5m": BacktestKlineSeriesRef;
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

interface BacktestKlineSeriesRef {
  file: string; // relative immutable content-addressed JSON file
  fingerprint: string;
  count: number;
  firstOpenT: number;
  lastCloseT: number;
}
```

Each referenced file contains one compact `Kline[]` for exactly one source
exchange, market type, canonical range, symbol, and interval. One-minute and
five-minute data are different files. Manifests for different symbol sets reuse
the same series files; adding one symbol must not duplicate or redownload the
files for existing symbols.

```text
storage/backtest-dataset/
  manifests/<dataset-key>.json
  series-index/<exchange>/<market>/<range-key>/<interval>/<symbol>.json
  klines/<content-fingerprint>.json
```

Kline files are immutable and content-addressed. A small series-index entry
maps one range/symbol/interval cache identity to its current kline file. A
refresh writes new immutable files first and atomically replaces index entries
and the manifest only after validation. Existing manifests therefore never
observe partially overwritten candle data.

Datasets are cache-first. Each series cache key uses source exchange, market,
canonical range identity, symbol, interval, and schema. The manifest key also
includes the normalized, sorted requested symbol set (including BTC). A preset
range uses its normalized selector such as `6month` or `1year`; it must not use
a newly calculated `Date.now()` in the key. A custom range uses its normalized
warmup/start/end boundaries.

With `upToDateKlines: false` (the default), valid series hits perform no kline
network requests. Only missing or invalid symbol/interval shards are
downloaded. Concurrent builds for the same series key share one in-flight build
or lock. With `upToDateKlines: true`, every requested series is explicitly
refreshed, fresh preset boundaries are resolved, and a new manifest is
published. The freshness flag controls lookup behavior; it is not part of
either cache key.

Klines remain raw per-symbol one-minute and five-minute candles; five-minute
candles are never derived from one-minute candles. vPoint formation is
reconstructed during the run by the
`detectVolatilityPoints` algorithm exposed through the existing detector module
over exactly the candles visible at each logical time, so the production
retrace-then-mark-peak timing is reproduced without copying or reinventing
detection. Reject gaps, duplicate candle times, reversed ranges, or missing
coverage.

TC: `BTEST:BACKTEST_DATASET`

# B. Logical time and visibility

Start from `initialState` at `startTime`. One logical runtime tick occurs at
each one-minute candle close after `startTime` through `endTime`. At time `t`,
only candles with `closeT <= t` are visible; requests that predate the dataset
fail the run with a clear error. The shared volatility memory captured with
the test case seeds the vPoint-detection starting state.

TC: `BOTH:BACKTEST_CANDLE_VISIBILITY`

# C. Shared runtime

Every tick invokes the due shared runtime stages using the cadence and ordering
in `RUNTIME_ENGINE.md` (risk sentinel, speedup, standard monitoring,
management, capture entry). Decisions, entry, averaging, exit, quantity, fee,
PnL, and position calculations are the same functions used by production,
called through the injected dataset-backed execution adapter. Backtest never
resolves the global production exchange factory.

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
retries, rate-limit usage) and is written to `storage/backtest-result`
atomically. Repeating the same run produces the same result.

The completed Precision result has a cache separate from the raw-kline series
cache. Its identity includes the exact manifest fingerprint, engine/result
schema revision, strategy/version, normalized runtime and trading settings,
enabled accounts in order, each account's starting state/balance, and simulated
execution settings. With `forceRecomputeBacktest: false` (the default), a valid
matching result is returned without running the engine again. With
`forceRecomputeBacktest: true`, the engine reruns against the cached dataset and
atomically replaces the result without downloading klines.

`upToDateKlines: true` refreshes the dataset and always reruns the engine for
that request. The legacy name `upToDateDecisionBacktest` is not used by
Precision; legacy pages may keep it. These controls are deliberately separate:

```text
upToDateKlines          -> refresh market dataset + rerun engine
forceRecomputeBacktest  -> reuse market dataset + rerun engine
both false              -> reuse matching completed result when available
```

TC: `BTEST:BACKTEST_REPRODUCIBLE`
TC: `BTEST:BACKTEST_METRICS`
TC: `BTEST:BACKTEST_RESULT_CACHE`

# F. Safety

- The driver refuses to run unless `PERSISTENT_STORAGE_ROOT` points at an
  isolated temp directory, so a backtest can never read or write production
  live/sandbox storage.
- The driver deletes notification credentials from its environment and the
  seeded runtime disables every notification channel.
- Withdrawals are rejected by the dataset-backed adapter.
