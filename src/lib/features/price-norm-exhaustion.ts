import type { FeatureHistoryPoint } from "./types";

/** Clamps a ratio to the score's 0–1 range. */
function unit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Scores an earlier move toward an extreme followed by repeated visits near
 * that extreme with little further progress. Mirroring the trail yields the
 * same score, so upward and downward moves share this calculation.
 * Uses only the supplied history and returns undefined when it is too short.
 */
function score(history: FeatureHistoryPoint[] | undefined): number | undefined {
  if (!Array.isArray(history)) return undefined;
  const points = history
    .filter((point) => Number.isFinite(point?.t) && Number.isFinite(point?.p))
    .sort((a, b) => a.t - b.t)
    .filter((point, index, sorted) => sorted[index + 1]?.t !== point.t);
  if (points.length < 4) return undefined;

  const span = points.at(-1)!.t - points[0].t;
  if (span < 24 * 60 * 60 * 1000) return undefined;

  let best = 0;
  for (const direction of [1, -1]) {
    const values = points.map((point) => point.p * direction);
    const latest = values.at(-1)!;
    const lastT = points.at(-1)!.t;
    const latestQuarterT = lastT - span * 0.25;
    let low = values[0];
    let lowIndex = 0;

    for (let index = 1; index < points.length - 1; index += 1) {
      const value = values[index];
      if (value < low) { low = value; lowIndex = index; continue; }
      if (points[index].t > points[0].t + span * 0.7 || lastT - points[index].t < span * 0.25) continue;
      const move = value - low;
      if (move < 0.12 || index - lowIndex < 2) continue;

      let path = 0;
      for (let step = lowIndex + 1; step <= index; step += 1) path += Math.abs(values[step] - values[step - 1]);
      if (path <= 0) continue;

      const near = value - move * 0.35;
      const away = value - move * 0.45;
      let leftExtreme = false;
      let revisits = 0;
      let laterHigh = value;
      let recentLow = latest;
      let recentHigh = latest;
      for (let step = index + 1; step < points.length; step += 1) {
        const later = values[step];
        laterHigh = Math.max(laterHigh, later);
        if (later <= away) leftExtreme = true;
        else if (leftExtreme && later >= near) { revisits += 1; leftExtreme = false; }
        if (points[step].t >= latestQuarterT) {
          recentLow = Math.min(recentLow, later);
          recentHigh = Math.max(recentHigh, later);
        }
      }

      const strength = unit(move / 0.25);
      const clarity = unit((move / path) / 0.6);
      const stall = 1 - unit((laterHigh - value) / (move * 0.5));
      const plateau = 1 - unit((recentHigh - recentLow) / (move * 0.5));
      const attempts = Math.max(unit(revisits / 2), plateau);
      const distance = Math.max(0, value - latest) / move;
      const stillRelevant = 1 - unit((distance - 0.8) / 0.4);
      best = Math.max(best, strength * clarity * stall * attempts * stillRelevant);
    }
  }
  return best;
}

const priceNormExhaustion = { score } as const;
export default priceNormExhaustion;
