import type { RuntimeContext } from "@/lib/precision/types";

import {
  computePriceNormalized,
  isSameNormalizedValue,
  replayPriceNormalizedHistory,
} from "./price-normalized";
import priceNormExhaustion from "./price-norm-exhaustion";
import { priceNormTrend } from "./price-norm-trend";
import prune from "./prune";
import vwap from "./vwap";
import vwapFeed from "./vwap-feed";
import {
  FEATURES_HISTORY_WINDOW_MS,
  type CoinFeatures,
  type FeatureHistoryPoint,
} from "./types";

const EMPTY_HISTORY: FeatureHistoryPoint[] = [];

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
  const cutoff = now - FEATURES_HISTORY_WINDOW_MS;
  const coins: Record<string, CoinFeatures> = {};
  for (const symbol of Object.keys(context.state.vPointsMap)) {
    const points = context.state.vPointsMap[symbol];
    const priceNormalized = computePriceNormalized({ now, points });
    // Monthly-anchored VWAP: derive the coin-facing `vwap` group from
    // the market-stage accumulator (lives at features.vwap — outside this
    // rebuilt map so the fold survives every pass).
    const vwapFields = vwap.derive(
      context.state.features?.vwap?.[symbol],
      context.state.markPriceMap?.[symbol]?.price,
      points?.at(-1)?.p,
    );
    // Step-series trail: append only when the value changed; reuse the
    // previous array when nothing moved so changedCoins stays sparse.
    // Legacy stores carried the trail flat (`priceNormalizedHistory`) —
    // the `.history` read simply misses there and the replay below
    // reseeds the group.
    const previousGroup =
      context.state.features?.coins[symbol]?.priceNormalized;
    let history = previousGroup?.history ?? EMPTY_HISTORY;
    if (history.length === 0 && priceNormalized !== undefined) {
      // No persisted trail (first boot, fresh symbol): reconstruct what
      // live ticks would have captured by replaying the pivot timeline.
      history = replayPriceNormalizedHistory({ now, points });
    }
    const last = history[history.length - 1];
    if (
      priceNormalized !== undefined &&
      !isSameNormalizedValue(last?.p, priceNormalized)
    ) {
      history = [...history, { p: priceNormalized, t: now }];
    }
    // Points append chronologically, so only the head can fall out of the
    // window — and keep the latest survivor so "unchanged since t" reads.
    if (history.length > 1 && history[0].t < cutoff) {
      history = history.filter(
        (point, index) =>
          point.t >= cutoff || index === history.length - 1,
      );
    }
    // Reuse the previous group object when neither member moved —
    // changedCoins diffs nested objects by identity, so a fresh wrapper
    // would list every coin on every pass. Missing derived values in an old
    // snapshot are calculated on the first refresh.
    const trend = priceNormTrend(history);
    // BOTH:FEATURE_GATE_INPUTS — shared by backtest, sandbox, and live.
    const exhaustion = previousGroup?.history === history &&
      Object.hasOwn(previousGroup, "exhaustion")
        ? previousGroup.exhaustion
        : priceNormExhaustion.score(history);
    const priceNormalizedGroup =
      isSameNormalizedValue(previousGroup?.current, priceNormalized) &&
      previousGroup?.history === history &&
      previousGroup.trend === trend &&
      previousGroup.exhaustion === exhaustion
        ? previousGroup
        : { current: priceNormalized, exhaustion, history, trend };
    coins[symbol] = {
      latestVpoint: points?.at(-1),
      priceNormalized: priceNormalizedGroup,
      ...(vwapFields && { vwap: vwapFields }),
    };
  }
  // Accumulators are inputs, not derived values — carry them through the
  // wholesale rebuild untouched.
  context.state.features = {
    coins,
    shared: {},
    vwap: context.state.features?.vwap,
  };
}

/**
 * Adapter-facing feature refresh — the body every `onFeatureUpdate` hook
 * should run before it diffs/persists. Feeds feature-scoped market inputs
 * (`vwap-feed` folds closed klines through `context.adapter.market`) then
 * runs the pure `update`. Keeps the runtime engine free of
 * feature-specific data paths: the engine calls the hook, the feature
 * pipeline owns what it needs.
 */
async function refresh(context: RuntimeContext): Promise<void> {
  await vwapFeed.update(context);
  update(context);
}

/**
 * Top-level coin keys excluded from `changedCoins` diffs — the whole
 * `vwap` group (mark/candle-driven fields move on nearly every pass) and
 * `latestVpoint` (the point object mutates in place on mark-price passes
 * and entry markers). They ride along in every written record but never
 * trigger one — otherwise the backtest stream and production
 * `features.json` flush would write each tick.
 */
const PER_PASS_KEYS = new Set<string>(["latestVpoint", "vwap"]);

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
  prune,
  refresh,
  update,
} as const;

export default features;
export type * from "./types";
export { FEATURES_VPOINT_WINDOW_MS } from "./types";
