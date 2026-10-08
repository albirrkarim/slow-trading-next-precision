/**
 * Scores a `priceNormalized` trail's trend clarity in [-1, 1]:
 * +1 = perfectly clear uptrend, −1 = perfectly clear downtrend, ~0 = sideways.
 *
 * The score is the Kaufman efficiency ratio: `net move / path length`, where
 * the path is the sum of absolute step-to-step changes. A monotone trail
 * traverses its own length exactly once → ±1; a trail that churns back and
 * forth accumulates path without going anywhere → ~0. Sign comes from the
 * net move. Works on sparse trails (3+ points) where correlation-based
 * scores degenerate — a slow coin whose normalized value steps a few times
 * still gets an honest reading.
 */

export const PRICE_NORM_TREND = {
  /** Fewer than three points is one step or less — a move, not a trend. */
  minPoints: 3,
} as const;

interface TrendPoint {
  p: number;
  t: number;
}

/**
 * Trend score for one trail: `{t, p}` samples (any order, the current
 * reading may be appended last). Returns 0 for missing/short/flat trails.
 */
export function priceNormTrend(points: TrendPoint[]): number {
  const pts = points
    .filter((point) => Number.isFinite(point?.t) && Number.isFinite(point?.p))
    .sort((a, b) => a.t - b.t);
  if (pts.length < PRICE_NORM_TREND.minPoints) return 0;

  let path = 0;
  for (let i = 1; i < pts.length; i += 1) {
    path += Math.abs(pts[i].p - pts[i - 1].p);
  }
  if (path <= 0) return 0;

  const net = pts[pts.length - 1].p - pts[0].p;
  return net / path;
}
