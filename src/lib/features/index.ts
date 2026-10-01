import type { RuntimeContext } from "@/lib/precision/types";
import autoRemove from "@/lib/system/trading/auto-remove";

import { computePriceNormalized } from "./price-normalized";
import type { CoinFeatures } from "./types";

/**
 * Recomputes `state.features` for every configured symbol from the current
 * runtime state. Replaces the whole store with a fresh object so callers
 * comparing against the previous snapshot see exact per-symbol diffs.
 *
 * Called inside `adapter.onFeatureUpdate` — production writes state only;
 * the backtest adapter additionally delta-records the artifact stream.
 */
function update(context: RuntimeContext): void {
  const coins: Record<string, CoinFeatures> = {};
  const symbols = new Set(
    context.state.config.management.symbols.map((symbol) =>
      autoRemove.symbol.normalize(symbol),
    ),
  );
  for (const symbol of symbols) {
    if (!symbol) continue;
    coins[symbol] = {
      priceNormalized: computePriceNormalized({
        now: context.state.currentTime,
        points: context.state.vPointsMap[symbol],
      }),
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
