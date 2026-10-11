import type { VolatilityPoint } from "@/lib/system/types";

import {
  FEATURES_HISTORY_WINDOW_MS,
  type CoinPriceNormalized,
  type FeatureHistoryPoint,
} from "../types";
import priceNormExhaustion from "./exhaustion";
import {
  computePriceNormalized,
  isSameNormalizedValue,
  replayPriceNormalizedHistory,
} from "./normalized";
import { priceNormTrend } from "./trend";

const EMPTY_HISTORY: FeatureHistoryPoint[] = [];

/**
 * Next `priceNormalized` group for one coin: the current envelope reading,
 * its step-series trail (appended only on change, trimmed to
 * `FEATURES_HISTORY_WINDOW_MS`), and the trail-derived trend/exhaustion
 * scores. Returns `previous` itself when nothing moved, so `changedCoins`
 * identity diffs stay sparse.
 */
function derive({
  now,
  points,
  previous,
}: {
  now: number;
  points: VolatilityPoint[] | undefined;
  previous: CoinPriceNormalized | undefined;
}): CoinPriceNormalized {
  const cutoff = now - FEATURES_HISTORY_WINDOW_MS;
  const current = computePriceNormalized({ now, points });
  // Legacy stores carried the trail flat (`priceNormalizedHistory`) — the
  // `.history` read simply misses there and the replay below reseeds it.
  let history = previous?.history ?? EMPTY_HISTORY;
  if (history.length === 0 && current !== undefined) {
    // No persisted trail (first boot, fresh symbol): reconstruct what live
    // ticks would have captured by replaying the pivot timeline.
    history = replayPriceNormalizedHistory({ now, points });
  }
  const last = history[history.length - 1];
  if (current !== undefined && !isSameNormalizedValue(last?.p, current)) {
    history = [...history, { p: current, t: now }];
  }
  // Points append chronologically, so only the head can fall out of the
  // window — and keep the latest survivor so "unchanged since t" reads.
  if (history.length > 1 && history[0].t < cutoff) {
    history = history.filter(
      (point, index) => point.t >= cutoff || index === history.length - 1,
    );
  }
  // Missing derived values in an old snapshot are calculated on the first
  // refresh.
  const trend = priceNormTrend(history);
  // BOTH:FEATURE_GATE_INPUTS — shared by backtest, sandbox, and live.
  const exhaustion =
    previous?.history === history && Object.hasOwn(previous, "exhaustion")
      ? previous.exhaustion
      : priceNormExhaustion.score(history);
  return isSameNormalizedValue(previous?.current, current) &&
    previous?.history === history &&
    previous.trend === trend &&
    previous.exhaustion === exhaustion
    ? previous
    : { current, exhaustion, history, trend };
}

export default derive;
