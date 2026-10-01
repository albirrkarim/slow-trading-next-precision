import type { VolatilityPoint } from "@/lib/system/types";

import {
  FEATURES_HISTORY_WINDOW_MS,
  FEATURES_VPOINT_WINDOW_MS,
  type FeatureHistoryPoint,
} from "./types";

/**
 * Normalizes the latest pivot price into the envelope of earlier pivot
 * prices seen within the trailing window:
 *
 *   priceNormalized = (latest.p - minP) / (maxP - minP)
 *
 * The latest pivot is excluded from its own reference range, so values above
 * 1 or below 0 mean the newest pivot formed beyond the prior envelope. The
 * numerator is a pivot price (not the mark price), which makes the feature a
 * step function that only moves when a new vPoint forms.
 *
 * Values are quantized to 3 decimals: the display precision, enough
 * granularity for gate bounds, and the point where recomputation float
 * drift and sub-0.1% moves stop churning the recorded trail.
 *
 * Returns `0.5` for a flat range and `undefined` until at least two earlier
 * pivots exist inside the window — absence is "no opinion", not a block.
 */
export function computePriceNormalized(params: {
  now: number;
  points: VolatilityPoint[] | undefined;
  windowMs?: number;
}): number | undefined {
  const points = params.points ?? [];
  const latest = points.at(-1);
  if (!latest || !Number.isFinite(latest.p) || latest.p <= 0) {
    return undefined;
  }
  const windowMs = params.windowMs ?? FEATURES_VPOINT_WINDOW_MS;
  const range = points.filter(
    (point) =>
      point.t >= params.now - windowMs &&
      point.t < latest.t &&
      Number.isFinite(point.p) &&
      point.p > 0,
  );
  if (range.length < 2) return undefined;

  let minP = Infinity;
  let maxP = -Infinity;
  for (const point of range) {
    if (point.p < minP) minP = point.p;
    if (point.p > maxP) maxP = point.p;
  }
  if (!(maxP > minP)) return 0.5;
  return parseFloat(((latest.p - minP) / (maxP - minP)).toFixed(3));
}

/**
 * Reconstructs the value-change trail live `features.update` ticks would
 * have produced from the pivot timeline itself: each in-window pivot is
 * evaluated as the latest against the envelope of the pivots before it, and
 * only value changes are kept. Seeds `priceNormalizedHistory` at boot when
 * no persisted trail exists — a restart then resumes with real history
 * instead of a single point.
 *
 * Envelope-slide drift between pivots (old pivots aging out of the window
 * with no new pivot forming) is not reproducible from pivot events alone —
 * the seed captures pivot-driven changes, which is where the excursions a
 * gate cares about happen.
 */
/**
 * Approximate equality for normalized values. Recomputed readings can drift
 * from a persisted value by float epsilon (e.g. 0.4 vs
 * 0.3999999999999999), so exact `!==` would append phantom changes on every
 * resume — values are ratios inside a small envelope, so 1e-9 separates
 * real moves from noise.
 */
export function isSameNormalizedValue(
  a: number | undefined,
  b: number | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return Math.abs(a - b) <= 1e-9;
}

export function replayPriceNormalizedHistory(params: {
  now: number;
  points: VolatilityPoint[] | undefined;
  windowMs?: number;
}): FeatureHistoryPoint[] {
  const points = params.points ?? [];
  const cutoff = params.now - FEATURES_HISTORY_WINDOW_MS;
  const history: FeatureHistoryPoint[] = [];
  for (let index = 0; index < points.length; index++) {
    const pivot = points[index];
    if (pivot.t < cutoff) continue;
    const value = computePriceNormalized({
      now: pivot.t,
      points: points.slice(0, index + 1),
      windowMs: params.windowMs,
    });
    if (value === undefined) continue;
    if (!isSameNormalizedValue(history[history.length - 1]?.p, value)) {
      history.push({ p: value, t: pivot.t });
    }
  }
  return history;
}
