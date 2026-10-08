/**
 * Scores a `priceNormalized` trail's trend clarity in [-1, 1]:
 * +1 = perfectly clear uptrend, −1 = perfectly clear downtrend, ~0 = sideways.
 *
 * The score is `r × coverage`: the Pearson correlation of value vs time
 * (direction + monotonicity) scaled by `min(1, |net move| / span)` — so a
 * smooth drift that traverses little of its own observed range reads as
 * weak even when it is noiseless, and a zigzag reads near zero even when it
 * spans a wide range.
 */

export const PRICE_NORM_TREND = {
  /** Trails shorter than this cannot establish a regime. */
  minPoints: 5,
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
    .filter(
      (point) =>
        Number.isFinite(point?.t) && Number.isFinite(point?.p),
    )
    .sort((a, b) => a.t - b.t);
  if (pts.length < PRICE_NORM_TREND.minPoints) return 0;

  const t0 = pts[0].t;
  const duration = pts[pts.length - 1].t - t0;
  if (duration <= 0) return 0;

  const n = pts.length;
  const xs = pts.map((point) => (point.t - t0) / duration);
  const ys = pts.map((point) => point.p);

  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let cov = 0;
  let varX = 0;
  let varY = 0;
  let min = ys[0];
  let max = ys[0];
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
    if (ys[i] < min) min = ys[i];
    if (ys[i] > max) max = ys[i];
  }

  const span = max - min;
  if (span <= 0 || varX <= 0 || varY <= 0) return 0;

  const r = cov / Math.sqrt(varX * varY);
  const slope = cov / varX; // normalized x → projected net move per window
  const coverage = Math.min(1, Math.abs(slope) / span);

  return r * coverage;
}
