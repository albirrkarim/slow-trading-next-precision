import type { RuntimeContext } from "@/lib/precision/types";

import { computePriceNormalized } from "./price-normalized";
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
 * Called inside `adapter.onFeatureUpdate` — production writes state only;
 * the backtest adapter additionally delta-records the artifact stream.
 */
function update(context: RuntimeContext): void {
  const now = context.state.currentTime;
  const cutoff = now - FEATURES_HISTORY_WINDOW_MS;
  const coins: Record<string, CoinFeatures> = {};
  for (const symbol of Object.keys(context.state.vPointsMap)) {
    const priceNormalized = computePriceNormalized({
      now,
      points: context.state.vPointsMap[symbol],
    });
    // Step-series trail: append only when the value changed; reuse the
    // previous array when nothing moved so changedCoins stays sparse.
    let history =
      context.state.features?.coins[symbol]?.priceNormalizedHistory ??
      EMPTY_HISTORY;
    const last = history[history.length - 1];
    if (priceNormalized !== undefined && last?.p !== priceNormalized) {
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
    coins[symbol] = {
      priceNormalized,
      priceNormalizedHistory: history,
    };
  }
  context.state.features = { coins, shared: {} };
}

/**
 * Lists symbols whose coin-feature values differ between two snapshots
 * (shallow per-field compare). Used by the backtest adapter to append a
 * record only when a feature actually changed — pivot-derived features are
 * step functions, so the delta stream stays sparse.
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
      if (before[key] !== after[key]) {
        changed.push(symbol);
        break;
      }
    }
  }
  return changed;
}

const features = {
  changedCoins,
  update,
} as const;

export default features;
export type * from "./types";
export { FEATURES_VPOINT_WINDOW_MS } from "./types";
