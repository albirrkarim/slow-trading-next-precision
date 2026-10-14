# Indicator Features

Configurable indicator instances computed as entry features in backtest,
sandbox, and live (`BOTH:INDICATOR_FEATURES`). Code: `src/lib/features/indicators/`.

## Config — `management.indicators`

A list of instances, edited in **Settings → Features** (the dashboard and the
backtest form share the same tab). Each backtest carries its own list in
`backtestConfig.settings.management.indicators`.

```ts
[
  { id: "vwap", type: "vwap", interval: "5m", anchor: "month" },
  { id: "st15", type: "supertrend", interval: "15m", atrLength: 10, factor: 3 },
  { id: "st1h", type: "supertrend", interval: "1h", atrLength: 10, factor: 2, on: false },
  { id: "ema200", type: "ema", interval: "1h", length: 200, source: "close" },
]
```

- `id` — `[a-z][a-z0-9_]{0,15}`, unique across all types. It is the key the
  reading is stored under. It is editable: a rename only moves where readings
  are stored (running state is keyed by params, so nothing re-warms).
- `interval` — `1m 5m 15m 30m 1h 2h 4h 1d`.
- `on: false` keeps the instance configured but uncomputed.
- Absent config → the default `[{ id: "vwap", type: "vwap", interval: "5m", anchor: "month" }]`.
  An explicit `[]` disables every indicator.
- Saved through `catalog.update` → `indicators.config.normalize` (invalid
  entries and duplicate ids are dropped, max 24 instances).
- Live config edits apply on the next tick (`refreshConfig` copies
  management; the feed resolves config every pass).

Types:

- `vwap` — anchor `session | week | month`, hlc3 volume-weighted, population
  σ of hlc3.
- `supertrend` — TradingView `ta.supertrend`: hl2 ± factor × Wilder-RMA ATR,
  ratcheting bands, flip on band cross.
- `ema` — TradingView `ta.ema`: α = 2 / (length + 1), seeded with the first
  source value; source `close | hl2 | hlc3`.

## Feed — one candle read per symbol per tick

`features.refresh` → `indicators.feed.update` → `features.update`.

- Base read: closed **1m** klines when any enabled instance uses 1m, else
  **5m** (the live stream carries only 1m/5m; the backtest dataset is 1m and
  derives 5m).
- Every larger interval is aggregated from base candles on UTC-aligned
  boundaries. A bucket folds once it closed and holds its last base candle,
  or once its close is 2 base candles old (data hole).
- Running state: `state.features.acc[paramsKey][symbol]`, e.g.
  `acc["st:15m:10:3"].SUI`. Identical params share one state. Keys no
  enabled instance uses are dropped.
- Warm-up for a fresh state: VWAP from its anchor start; Supertrend from
  `max(200, 20 × atrLength)` candles back; EMA from `max(200, 5 × length)`
  candles back — all capped at **55 days** (backtests start trading 2 months
  after the dataset start). A Supertrend or EMA state older than 55 days
  reseeds.
- A state with no complete candle pending skips the read entirely, so large
  intervals cost nothing between boundaries.

## Feature store and snapshots

```ts
coins.SUI.ind = {
  vwap: { vwap: { price, stdev, distancePct, stretchPct, anchorT, dSigma } },
  supertrend: { st15: { d: 1, l: 0.3121, dPct: 2.1, fT: 1621148400000 } },
  ema: { ema200: { v: 0.3054, dPct: -1.2, sPct: 0.03 } },
};
features.defs = { vwap: {...config}, st15: {...config} }; // enabled instances
```

- Supertrend: `d` 1 = up / -1 = down, `l` line (5 significant digits), `dPct`
  mark distance pct, `fT` open time of the flip candle. Absent during warm-up.
- EMA: `v` value (5 significant digits), `dPct` mark distance pct, `sPct`
  last-candle slope pct. Absent until `length` candles folded.
- `changedCoins` compares each instance's change key: a Supertrend flip (or
  warm-up finishing) writes a backtest feature record / `features.json` flush;
  VWAP, EMA, and a moving Supertrend line never do on their own.
- Entry snapshots (`prune.forPosition` → `position.strategy.entry.feature`,
  dataset rows) keep `coins.{BTC, symbol}.ind` plus `defs`, never `acc`.

## Readers and fallbacks

Read through `indicators.read`, never the raw path:

- `indicators.read.vwap(coin, id = "vwap")` → `ind.vwap[id]`, else (for the
  default id only) the pre-indicator `coin.vwap` group, else the oldest flat
  `vwap*` fields.
- Feature gates v2–v5 read the monthly VWAP from id `vwap`. Without that
  instance (VWAP, month, enabled) they reject for missing VWAP data; the
  Features tab warns about it.

## Gates

- Feature gate **v6** (`features/v6`, `BOTH:FEATURE_GATE_V6_SUPERTREND`) is
  v5 plus the `supertrend` sub-gate (on by default): every
  `ind.supertrend.<id>` of the signal's coin must point the trade's way —
  a TOP signal (`l: "T"`, short) needs every `d === -1`, a BOTTOM (long)
  every `d === 1`. Fails closed when the coin has no Supertrend reading.

- Strategy **human_v1** (`src/lib/strategies/human_v1`, README there) trades
  the indicators directly, without vPoints: enter when every Supertrend
  flipped the same way within 1 day of each other (newest flip at most 1 day
  old) while price is above the first enabled EMA (`BOTH:HUMAN_V1_ENTRY`).
  LONG: SL at the EMA, TP at monthly VWAP + 1.5σ. SHORT: SL at VWAP + 1σ,
  TP at VWAP − 1.5σ, which must be below the EMA. TP/SL ride on the position
  plan (`BOTH:STRATEGY_PLAN_EXIT`) next to every shared exit rule; never
  average (`BOTH:HUMAN_V1_NO_AVERAGING`).

## Surfaces

- Trade feature preview lists every captured Supertrend, EMA, and extra VWAP.
- Dataset filters expose `ind:<type>:<id>:<field>` metrics (Supertrend `d`,
  `dPct`, `flipAgeMin`; VWAP `distancePct`, `stretchPct`, `dSigma`; EMA
  `dPct`, `sPct`), also via
  MCP `feature_gate_rows`.
- Trade charts: Indicators → Supertrend / EMA, or **From captured features** to
  draw the entry's `defs` — each overlay folds the same interval's closed
  candles (with warm-up) and is resampled onto the chart's candles.
