# Features

`src/lib/features` is the replaceable feature pipeline: it computes the
per-symbol values at `state.features` that strategies, gates, and entry
snapshots consume — in every environment identically.

The runtime engine does not know what a feature needs. It only invokes
the `onFeatureUpdate` adapter hook (warmup and before every entry
capture); everything the feature store requires — including its own
market data — is owned by this module.

Behavior spec: `docs/SPECS/INDICATORS.md`.

## Directory structure

```text
features/
  index.ts             features = { update, refresh, changedCoins, prune, priceNorm, indicators }
  types.ts             Store contracts: RuntimeFeatures, CoinFeatures, CoinPriceNormalized
  prune.ts             Entry-commit snapshot pruner (pure)
  price-norm/          Pivot-envelope family (pure)
    index.ts           priceNorm = { compute, derive, replay, isSame, trend, exhaustion, movement }
    normalized.ts      Envelope reading + pivot-timeline replay
    derive.ts          Next priceNormalized group (reading + trail + scores)
    trend.ts           Efficiency-ratio trend score
    exhaustion.ts      Exhaustion score
    movement.ts        BTC ↔ coin trail correlation
  indicators/          Configurable indicators (`management.indicators`)
    index.ts           indicators = { config, registry, feed, derive, changed, read, candles, math }
    types.ts           Shared contracts: config union, IndicatorDefinition, readings map
    constants.ts       Intervals, id rule, limits (leaf — no runtime imports)
    registry.ts        Type → definition map
    config.ts          Defaults, normalize (field-driven), resolve, defs, key
    read.ts            Readers with legacy-shape fallbacks
    feed/
      index.ts         Kline I/O: base 1m/5m read → aggregate → fold (the only I/O)
      candles.ts       Base-candle aggregation onto UTC boundaries (pure)
    vwap/              One folder per indicator type:
      index.ts           vwap = { ...math, definition }
      types.ts           config, running state, reading
      math.ts            pure fold / derive
      definition.ts      IndicatorDefinition for the registry
    supertrend/        (same shape)
    ema/               (same shape)
```

Import the grouped entities, never module internals:

```ts
import features from "@/lib/features";
import indicators from "@/lib/features/indicators";
import priceNorm from "@/lib/features/price-norm";
```

## Public API

- `features.update(context)` — **pure**. Per symbol in `vPointsMap`:
  `priceNorm.derive` + `indicators.derive`, written to a fresh `coins`
  map; carries `acc` through and stamps `defs`. Never performs I/O.
- `features.refresh(context)` — **orchestration**, the body every
  `onFeatureUpdate` implementation runs: `indicators.feed.update` (candle
  I/O through `context.adapter.market`), then `update`.
- `features.changedCoins(prev, next)` — per-symbol diff that keeps
  persistence sparse. Groups compare by identity (derivers reuse
  unchanged objects); `ind` compares each instance's `changeKey`;
  `latestVpoint` never triggers a write.
- `features.prune.forPosition(store, symbol)` — **pure**. Deep-clones the
  store down to `shared`, `defs`, and the BTC anchor + the position's own
  coin; running state (`acc`) is dropped.

Adapter wiring:

```ts
onFeatureUpdate: async (context) => {
  const previous = context.state.features;
  await features.refresh(context);
  // environment tail: persist features.json / append artifact records
};
```

## Store shape

```ts
state.features = {
  shared: Record<string, number>,                          // cross-coin features
  coins: Record<symbol, CoinFeatures>,                     // derived, gate-facing values
  acc: Record<paramsKey, Record<symbol, IndicatorAccumulator>>, // running state (input)
  defs: Record<id, FeatureIndicatorConfig>,                // enabled indicator definitions
};

CoinFeatures = {
  latestVpoint?: VolatilityPoint,                          // newest pivot (mutates in place)
  priceNormalized: { current?, history, trend?, exhaustion? },
  ind?: { vwap?: Record<id, CoinVwap>, supertrend?: Record<id, CoinSupertrend>, ema?: Record<id, CoinEma> },
};
```

Two layers, deliberately:

- **Running state** (`acc`) — foldable state that survives between
  passes. Written by the feed, read by `update`. It lives *outside*
  `coins` because `update` rebuilds that map wholesale every pass.
- **Derived** (`coins[s]`) — quantized, gate-facing groups. Absent means
  "no opinion" (warm-up, missing data), never `0`.

## Invariants

- `update` is deterministic state-in/state-out. All I/O lives in the
  indicator feed — reachable only through `context.adapter.market` (live
  kline buffer first, REST/dataset backfill on miss), so the same math
  runs on backtest data, sandbox, and live.
- Gates read through `indicators.read`, which falls back to the shapes
  older snapshots were recorded in.
- Quantize derived values (4–5 sig digits for prices, 0.1 for percents)
  so the backtest feature-delta stream stays sparse.

## Adding an indicator type

1. `indicators/<type>/` — copy the `supertrend/` shape:
   - `types.ts`: config (extends `FeatureIndicatorBase`), running state,
     reading;
   - `math.ts`: pure fold + derive;
   - `definition.ts`: the `IndicatorDefinition` — `fields` (drive
     validation and the settings form), `defaults`, `key`, `summary`,
     `state` (create / warmupStartMs / stale / fold), `derive`,
     `changeKey`, `metrics` (dataset filters);
   - `index.ts`: `{ ...math, definition }`.
2. In `indicators/types.ts`: add the type to `FeatureIndicatorType`, the
   config/state/reading unions, `CoinIndicators`, and re-export its types.
3. Register it in `indicators/registry.ts`.
4. Optional UI: a reading row in `TradeFeaturePreview/IndicatorReadings`
   and a chart overlay under `components/charts/indicators`.

The feed, config normalization, settings form, entry snapshots, and
dataset filters pick it up without changes.
