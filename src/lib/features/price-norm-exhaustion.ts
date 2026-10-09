import type { FeatureHistoryPoint } from "./types";

/** Clamps a ratio to the score's 0–1 range. */
function unit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Scores a recent extreme followed by a sustained turn away from it. */
function turnScore(points: FeatureHistoryPoint[], values: number[], span: number): number {
  const latest = values.at(-1)!;
  const lastT = points.at(-1)!.t;
  let low = values[0];
  let lowIndex = 0;
  let best = 0;
  for (let index = 1; index < points.length - 3; index += 1) {
    const value = values[index];
    if (value < low) { low = value; lowIndex = index; continue; }
    if (points[index].t < points[0].t + span * 0.5 || lastT - points[index].t < span * 0.05) continue;
    const move = value - low;
    if (move < 0.25 || index - lowIndex < 3) continue;

    let path = 0;
    for (let step = lowIndex + 1; step <= index; step += 1) path += Math.abs(values[step] - values[step - 1]);
    const later = values.slice(index + 1);
    const laterHigh = Math.max(...later);
    if (path === 0 || laterHigh > value + move * 0.08) continue;

    const rebound = (value - latest) / move;
    const turn = unit((rebound - 0.08) / 0.25) * (1 - unit((rebound - 0.85) / 0.3));
    const range = Math.max(...later) - Math.min(...later);
    const containment = 1 - unit((range / move - 0.4) / 0.7);
    best = Math.max(best, unit(move / 0.3) * unit((move / path) / 0.35) * turn * containment);
  }
  return best;
}

/** Scores a repeatedly visited upper range that later resolves away from it. */
function rangeBreakScore(points: FeatureHistoryPoint[], values: number[], span: number): number {
  const latest = values.at(-1)!;
  let best = 0;
  for (const fraction of [0.45, 0.55, 0.65]) {
    const splitT = points[0].t + span * fraction;
    const prefix = values.filter((_, index) => points[index].t <= splitT);
    if (prefix.length < 5 || points.length - prefix.length < 3) continue;
    const high = Math.max(...prefix);
    const low = Math.min(...prefix);
    const range = high - low;
    const departure = high - latest;
    if (departure < 0.18 || latest >= low - 0.05) continue;

    const near = high - Math.max(0.04, range * 0.25);
    const away = high - Math.max(0.07, range * 0.45);
    let leftHigh = false;
    let revisits = 0;
    for (const value of prefix) {
      if (value <= away) leftHigh = true;
      else if (leftHigh && value >= near) { revisits += 1; leftHigh = false; }
    }
    const stall = Math.max(unit(revisits / 2), 1 - unit(range / 0.25));
    const breakdown = unit((low - latest) / 0.2);
    best = Math.max(best, stall * unit(departure / 0.3) * (0.4 + 0.6 * breakdown));
  }
  return best;
}

/**
 * Scores stalled extremes, early turns, and range breaks. Mirroring the trail
 * yields the same score, so upward and downward moves share the calculation.
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
    best = Math.max(best, turnScore(points, values, span), rangeBreakScore(points, values, span));
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
