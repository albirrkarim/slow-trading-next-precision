# Features

`src/lib/features` is the replaceable feature pipeline: it computes the
per-symbol values at `state.features` that strategies, gates, and entry
snapshots consume — in every environment identically.

The runtime engine does not know what a feature needs. It only invokes
the `onFeatureUpdate` adapter hook (warmup and before every entry
capture); everything the feature store requires — including its own
market data — is owned by this module.

## Directory structure

```text
features/
  index.ts            Public API: update (pure), refresh (orchestration), changedCoins
  types.ts            RuntimeFeatures / CoinFeatures / VwapAccumulator contracts
  price-normalized.ts Pivot-envelope normalization + history replay (pure)
  prune.ts            Entry-commit snapshot pruner (pure)
  vwap.ts             Monthly-anchored VWAP fold and σ derivation (pure)
  vwap-feed.ts        Kline I/O feeding the VWAP accumulators
```

## Public API

```ts
import features from "@/lib/features";
```

- `features.update(context)` — **pure**. Reads `vPointsMap`,
  `markPriceMap`, and the raw accumulators on `state.features`; writes a
  fresh `coins` map. Never performs I/O, never imports an adapter.
- `features.refresh(context)` — **orchestration**, the body every
  `onFeatureUpdate` implementation should run: feeds feature-scoped
  market inputs (`vwapFeed`) then calls `update`.
- `features.changedCoins(prev, next)` — shallow per-symbol diff used by
  adapters to keep feature persistence sparse (nested groups compare by
  identity — `update` reuses unchanged group objects). The `vwap` and
  `latestVpoint` keys are excluded from the diff: they ride along in any
  record a real change triggers but never trigger one themselves.
- `features.prune.forPosition(store, symbol)` — **pure**. Entry-commit
  snapshot pruner: deep-clones the store down to `shared` plus the BTC
  anchor and the position's own coin; the `vwap` accumulator layer is
  dropped (raw substrate, not entry context).

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
  shared: Record<string, number>,            // cross-coin features
  coins: Record<symbol, CoinFeatures>,       // derived, gate-facing values
  vwap: Record<symbol, VwapAccumulator>,     // raw substrate (input)
};

CoinFeatures = {
  latestVpoint?: VolatilityPoint,            // newest pivot (mutates in place)
  priceNormalized: { current?: number; history: FeatureHistoryPoint[] },
  vwap?: { price, stdev, distancePct, stretchPct, anchorT },
};
```

Two layers per feature, deliberately:

- **Accumulator** (`features.vwap[s]`) — foldable state that survives
  between passes (`{aT, pv, v, s, s2, n, t}`). Written by the feed, read
  by `update`. It lives *outside* `coins` because `update` rebuilds that
  map wholesale every pass — anything stored inside `coins` is destroyed.
- **Derived** (`coins[s]`) — grouped feature objects: `priceNormalized`
  carries the current reading plus its change trail, `vwap` carries the
  quantized monthly-anchored numbers, and `latestVpoint` mirrors the
  newest pivot so entry snapshots freeze the signal point. The `vwap`
  mark-driven fields and the in-place-mutating `latestVpoint` move every
  pass, so `changedCoins` ignores both keys — they are written alongside
  any record a pivot-driven change triggers but never trigger a write
  themselves, keeping the backtest artifact stream and production
  `features.json` flush sparse.

Symbols follow `vPointsMap` keys — the canonical tracked set (configured
coins, open-position coins, BTC context) already maintained by the
engine's market stage. Position snapshots stored at entry are pruned:
BTC + the position's own coin, no accumulators.

## Invariants

- `update` is deterministic state-in/state-out. All I/O lives in feeds
  run by `refresh` — reachable only through `context.adapter.market`
  (live kline buffer first, REST backfill on buffer miss), so the same
  math runs on backtest data, sandbox, and live.
- A feature absent must read as "no opinion", not `0` — gates fail
  closed on missing data and pass when the feature genuinely cannot be
  judged (same contract as `priceNormalized`).
- Quantize derived values (4 sig digits for prices, 0.1 for percents) so
  the backtest feature-delta stream stays sparse.

## Adding a feature

1. Raw state that must persist between passes → a top-level slot on
   `RuntimeFeatures` (never inside `coins`).
2. Pure math → a module like `vwap.ts` (fold + derive, no I/O).
3. Needs candles or other market data → a `*-feed.ts` that reads
   `context.adapter.market`; the engine must not learn about it.
4. Derive into `CoinFeatures` groups inside `update`; wire the feed
   call inside `refresh`.
