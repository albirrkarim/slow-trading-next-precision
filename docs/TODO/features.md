# Feature Store — `state.features`

## Goal

Give the engine a feature store produced continuously before entry capture,
so a strategy can gate entries on feature values, backtests can chart
features over time, and positions can snapshot the features seen at entry
for later evaluation.

The default strategy ignores features — gating is opt-in via a new strategy
`src/lib/strategies/default_with_features_gate` that wraps the default
pipeline with a feature predicate.

## Shape

```ts
// state.features
interface RuntimeFeatures {
  /** Global/cross-coin features. */
  shared: Record<string, number>;
  /** Per-symbol features keyed by base symbol (same keys as vPointsMap). */
  coins: Record<string, CoinFeatures>;
}

interface CoinFeatures {
  /** Position of the latest pivot price within the 2-month pivot envelope:
   * 0 = range floor, 1 = range top, >1/<0 = beyond prior envelope, 0.5 = no
   * valid range. Step function — changes only when a new vPoint forms. */
  priceNormalized?: number;
}
```

## Production

- `RuntimeEngineState.features?: RuntimeFeatures` — snapshotted into
  precision test cases like `vPointsMap`/`blackSwanStatus`.
- `features.coins` iterates `state.vPointsMap` keys — the tracked set, which
  always includes BTC as the market-context anchor (`entry.getSymbols` adds
  it unconditionally), so BTC features exist even when BTC is not traded.
- `adapter.onFeatureUpdate(context)` runs once at startup warm-up and before
  every capture-entry stage (after `updateMarkPrice`/`updateVPointsMap`).
  Every adapter delegates to the same shared module — the math must be
  identical across live/sandbox/backtest (also wired on the quick-backtest
  and `driver/backtest-precision` adapters, which don't persist a stream).

```ts
// src/lib/features/
//   types.ts              — RuntimeFeatures, CoinFeatures, feature config
//   index.ts              — grouped export: features.update(context)
//   price-normalized.ts   — first extractor; one file per feature as it grows

// everything here is pure, env-neutral math — reads state/config, writes
// state.features, no I/O, no adapter imports
features.update(context);
```

```ts
// production adapter — state only
onFeatureUpdate: (context) => features.update(context),

// backtest adapter — same compute + per-symbol delta-record artifact.
// `features.changedCoins` shallow-compares the previous coin snapshot; each
// changed symbol appends `{ t: currentTime, ...coinFeatures }` to its own
// `features/<symbol>/part-*.json` stream.
onFeatureUpdate: async (context) => {
  const previous = context.state.features;
  features.update(context);
  for (const symbol of features.changedCoins(
    previous?.coins,
    context.state.features?.coins ?? {},
  )) {
    await spool.pushFeature(symbol, {
      ...context.state.features.coins[symbol],
      t: context.state.currentTime,
    });
  }
},
```

## `priceNormalized`

```ts
// pivot envelope = vPoints within last 2 months, excluding the latest point
const window = points.filter((p) => p.t >= now - TWO_MONTHS_MS && p.t < latest.t);
priceNormalized = (latest.p - minP) / (maxP - minP);
```

- Numerator is the **latest `vpoint.p`**, not the mark price — the feature is
  sparse by construction (moves only on new pivots), which is what makes
  delta-recording cheap.
- The latest pivot is **excluded** from its own range — `>1` / `<0` then mean
  "new pivot beyond the prior 2-month envelope" instead of a self-fulfilling
  edge reading.
- Gate semantics: `<= 0.2` = pivot formed near the range floor (dip zone),
  `>= 0.8` = near the top (chasing). Thresholds live in config.
- Undefined until a symbol has >= 2 pivots in the window — no opinion, not a
  block.

## vPointsMap retention

`state.vPointsMap` must hold 2 months of pivots — previously capped purely
by count (`DEFAULT_RECENT_VPOINTS = 10`). `vpoints.retainRecent` now takes a
`sinceMs` clause: `keep = latest N OR point.t >= sinceMs OR position-
referenced`. `FEATURES_VPOINT_WINDOW_MS` (`src/lib/features/types.ts`) is
the shared 2-month span — passed by `helper/market` retention, the
production bootstrap seed, and the test-case `snapshotVPoints` so the
envelope survives every trim. Warmup already seeds 2 months
(`VPOINT_INITIAL_LOOKBACK_MINUTES`), so features are defined from the first
trading tick in backtest and production boot.

## Backtest display

- `features/<symbol>/part-*.json` artifact stream (same chunked spool as
  `vpoints/<symbol>/`), appended by the backtest adapter's `onFeatureUpdate`
  only when a coin's feature values change; records are
  `BacktestFeatureRecord = { t } & CoinFeatures`.
- `manifest.features` reports per-symbol part counts; `CACHE_VERSION = 10`
  forces reruns, and `/api/dev/backtest-precision/detail?field=features`
  serves the stream lazily (`{ featuresMap }` or `{ symbol, features }`).
- `PriceNormalized.tsx` — a standalone collapsible section **below
  Volatility Rails** with its own header, own brush (no zoom sync), and lazy
  artifact load on first expand.
- One `priceNormalized` **step line** (`lineType="stepAfter"`) per symbol —
  only for symbols with at least one defined record; per-point colors reuse
  the Volatility Rails palette order so each coin keeps its color.
- Horizontal guides (`yReferenceLines`) at 0 and 1 plus the configured gate
  bounds from `management.featureGate`.

## Entry snapshot

At commit, snapshot the symbol's coin features into
`position.strategy.entry.feature` — the existing `Position<TFeature>` slot
the shared runtime never reads inside. Precedence: `decision.feature`
(strategy-authored override) else `state.features.coins[symbol]` — so every
position records its entry features regardless of strategy, enabling
post-hoc evaluation of feature values vs outcomes.

## Strategy

`src/lib/strategies/default_with_features_gate` (registered as
`StrategySlug` `"default_with_features_gate"`):

- `decisions.entry.find` wraps `defaultDecision.entry.find` and drops
  candidates whose coin's `priceNormalized` falls outside
  `management.featureGate` bounds
  (`FeatureGateConfig.minPriceNormalized` / `.maxPriceNormalized`,
  inclusive). Undefined feature values never block — "no opinion" is not a
  veto.
- **No `guard` member** — the engine falls back to the shared
  `guard.allows` wholesale, so every shared protection (runner toggle,
  black-swan, daily-PnL, capacity) applies unchanged. Filtering happens at
  the producer level instead, per the strategy contract.
- No `shape` — operator-forced manual entries bypass the gate by design.
- `diagnostics.explain` returns `FEATURE_GATE` ("Blocked by the feature
  gate: priceNormalized 0.95 is above the configured maximum 0.8.") so the
  dashboard explains the skip instead of a silent no-entry.
- Bounds are editable in Settings → Management when the strategy is
  selected; `featureGate` rides `SHARED_MANAGEMENT_CONFIG_KEYS` so settings
  saves and effective-config extraction preserve it.

## Status notes (implemented)

- `PrecisionRuntimeSnapshot.features` is captured at record start and end
  and hydrated into replay `state.features`, so the first replayed tick sees
  the production store instead of an empty map; `features.update` recomputes
  it deterministically afterwards.
- Recording cadence is delta-based (sparse by design) — but a float never
  repeats exactly, so compare with a tolerance epsilon if any future feature
  moves continuously.
- Unit coverage: `features.test.ts` (extractor envelope math, degenerate
  cases, `changedCoins`, retention `sinceMs`, gate filter + diagnostics),
  `backtest-artifacts.test.ts` (feature stream spool/read), cache-publish
  v10 key.
