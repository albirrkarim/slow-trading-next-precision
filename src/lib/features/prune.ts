/**
 * Entry-commit snapshot pruner — slims the live feature store down to the
 * context a persisted position actually reads. Pure function, no I/O;
 * called by the shared entry commit before the snapshot lands on
 * `position.strategy.entry.feature`.
 */
import type { CoinFeatures, RuntimeFeatures } from "./types";

/**
 * Returns the position-facing slice of the live feature store:
 * `position.strategy.entry.feature` stores only the BTC anchor plus the
 * position's own coin; the rest of the store is cross-symbol working
 * state, not entry context. The `vwap` accumulator layer is dropped
 * entirely — raw feed substrate, not gate-facing context.
 *
 * The result is a deep clone (`structuredClone`):
 * `CoinFeatures.latestVpoint` is a live object that mutates in place, so
 * sharing it would let the stored snapshot drift with later ticks. The
 * `coins` record is always present — `{}` when neither key exists — so
 * readers keep a valid store shape.
 */
function forPosition(
  features: RuntimeFeatures | undefined,
  symbol: string,
): RuntimeFeatures | undefined {
  if (!features) return undefined;
  const coins: Record<string, CoinFeatures> = {};
  // BTC first so a BTC position keeps a single anchor entry — the keyed
  // record dedupes the overlap for free.
  for (const key of ["BTC", symbol.toUpperCase()]) {
    const coin = features.coins[key];
    if (coin) coins[key] = coin;
  }
  return structuredClone({ coins, shared: features.shared });
}

const prune = { forPosition } as const;

export default prune;
