import type { RuntimeContext } from "@/lib/precision/types";

import indicators from "./indicators";
import priceNorm from "./price-norm";
import prune from "./prune";
import type { CoinFeatures } from "./types";

/**
 * Recomputes `state.features` from the current runtime state for every
 * symbol present in `state.vPointsMap` — the map already carries the
 * canonical tracked set (configured coins, open-position coins, and the
 * BTC market context), so features follow exactly the symbols that have
 * pivot data in both backtest and production.
 *
 * Replaces the whole store with a fresh object so callers comparing
 * against the previous snapshot see exact per-symbol diffs.
 *
 * Called by `features.refresh` inside `adapter.onFeatureUpdate` —
 * production writes state only; the backtest adapter additionally
 * delta-records the artifact stream.
 */
function update(context: RuntimeContext): void {
  const now = context.state.currentTime;
  const instances = indicators.config.resolve(
    context.state.config.management.indicators,
  );
  const acc = context.state.features?.acc;
  const coins: Record<string, CoinFeatures> = {};
  for (const symbol of Object.keys(context.state.vPointsMap)) {
    const points = context.state.vPointsMap[symbol];
    const previous = context.state.features?.coins[symbol];
    // Dynamic indicators (VWAP, Supertrend, …) derive from the feed's
    // running state (features.acc — outside this rebuilt map so the folds
    // survive every pass).
    const ind = indicators.derive({
      acc,
      context: {
        markPrice: context.state.markPriceMap?.[symbol]?.price,
        signalPrice: points?.at(-1)?.p,
      },
      instances,
      previous: previous?.ind,
      symbol,
    });
    coins[symbol] = {
      latestVpoint: points?.at(-1),
      priceNormalized: priceNorm.derive({
        now,
        points,
        previous: previous?.priceNormalized,
      }),
      ...(ind && { ind }),
    };
  }
  // Accumulators are inputs, not derived values — carry them through the
  // wholesale rebuild untouched.
  context.state.features = {
    acc,
    coins,
    defs: indicators.config.defs(instances),
    shared: {},
  };
}

/**
 * Adapter-facing feature refresh — the body every `onFeatureUpdate` hook
 * should run before it diffs/persists. Feeds feature-scoped market inputs
 * (the indicator feed folds closed klines through `context.adapter.market`)
 * then runs the pure `update`. Keeps the runtime engine free of
 * feature-specific data paths: the engine calls the hook, the feature
 * pipeline owns what it needs.
 */
async function refresh(context: RuntimeContext): Promise<void> {
  await indicators.feed.update(context);
  update(context);
}

/**
 * Top-level coin keys excluded from identity diffs in `changedCoins` —
 * `latestVpoint` (mutates in place on mark-price passes and entry markers)
 * and the legacy `vwap` group. `ind` is compared by each indicator's
 * `changeKey` instead (a Supertrend flip counts; VWAP never does). They
 * ride along in every written record but never trigger one on their own —
 * otherwise the backtest stream and production `features.json` flush would
 * write each tick.
 */
const PER_PASS_KEYS = new Set<string>(["ind", "latestVpoint", "vwap"]);

/**
 * Lists symbols whose coin-feature values differ between two snapshots
 * (shallow per-key compare — nested groups like `priceNormalized` compare
 * by identity, which `update` preserves by reusing unchanged group
 * objects — ignoring `PER_PASS_KEYS`). Used by the backtest adapter to
 * append a record only when a feature actually changed — pivot-derived
 * features are step functions, so the delta stream stays sparse.
 */
function changedCoins(
  previous: Record<string, CoinFeatures> | undefined,
  next: Record<string, CoinFeatures>,
): string[] {
  const changed: string[] = [];
  for (const symbol of Object.keys(next)) {
    const before = previous?.[symbol];
    const after = next[symbol];
    if (!before || !after) {
      changed.push(symbol);
      continue;
    }
    if (indicators.changed(before.ind, after.ind)) {
      changed.push(symbol);
      continue;
    }
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      if (!PER_PASS_KEYS.has(key) && before[key] !== after[key]) {
        changed.push(symbol);
        break;
      }
    }
  }
  return changed;
}

const features = {
  changedCoins,
  indicators,
  priceNorm,
  prune,
  refresh,
  update,
} as const;

export default features;
export type * from "./types";
export { FEATURES_VPOINT_WINDOW_MS } from "./types";
