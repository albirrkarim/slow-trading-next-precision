import type { VolatilityPoint } from "@/lib/system/types";

import { FEATURES_VPOINT_WINDOW_MS } from "./types";

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
  return (latest.p - minP) / (maxP - minP);
}
