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
- `adapter.onFeatureUpdate(context)` runs before the capture-entry stage
  (after `updateMarkPrice`/`updateVPointsMap`). Both adapters delegate to the
  same shared module — the math must be identical across live/sandbox/backtest.

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

// backtest adapter — same compute + delta-record artifact
onFeatureUpdate: async (context) => {
  const previous = context.state.features?.coins;
  features.update(context);
  if (differs(previous, context.state.features.coins)) {
    await spool.pushFeatures(context.state.features);
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

`state.vPointsMap` must hold 2 months of pivots — currently capped by count
(`DEFAULT_RECENT_VPOINTS = 10`). Extend `retainRecent` with a time-window
clause: `keep = within 2 months OR latest N OR position-referenced`. Warmup
already seeds 2 months (`VPOINT_INITIAL_LOOKBACK_MINUTES`), so features are
defined from the first trading tick in backtest and production boot.

## Backtest display

- New `features/` artifact stream (same chunked spool pattern as
  `vpoints/<symbol>/`), appended by the backtest adapter's
  `onFeatureUpdate` only when a value changes.
- New dedicated section **below Volatility Rails** — fully separate
  collapsible section with its own header ("Price Normalized"), not nested
  inside VolatilityRails or sharing its header/metrics.
- One `priceNormalized` line per symbol, horizontal guides at the gate
  bounds (e.g. 0.2 / 0.8) plus 0 and 1.
- Reuses `MultiLineTimelined` but keeps its **own independent brush** —
  no zoom sync with the volatility chart.

## Entry snapshot

At commit, copy the symbol's coin features into the position record
(`position.features` or similar) so post-hoc evaluation can correlate entry
feature values with outcomes.

## Strategy

`src/lib/strategies/default_with_features_gate`:

- `decisions.entry.find` wraps `defaultDecision.entry.find` and filters
  candidates through the feature gate (configurable bounds in
  `management`/strategy config so backtest drafts can tune them).
- `guard` delegates to shared `guard.common`/`guard.entry.policy` — do not
  reimplement protections.
- `diagnostics.explain` reports gate rejections ("feature gate:
  priceNormalized 0.93 > 0.8") so blocked entries are explainable.

## Open considerations

- Precision-checker replays recompute features deterministically; capture
  the starting `features` in `initialState` so the first tick doesn't see an
  empty map.
- Recording cadence is delta-based (sparse by design) — but a float never
  repeats exactly, so compare with a tolerance epsilon if any future feature
  moves continuously.
