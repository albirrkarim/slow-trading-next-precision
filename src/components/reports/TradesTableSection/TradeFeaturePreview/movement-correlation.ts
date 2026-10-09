import type { FeatureHistoryPoint } from "@/lib/features/types";

const INTERVALS = 32;
const MOVEMENT_LAG = 4;

/** Sorts recorded steps without changing the feature snapshot. */
function ordered(history: FeatureHistoryPoint[]): FeatureHistoryPoint[] {
  const points = history
    .filter((point) => Number.isFinite(point?.t) && Number.isFinite(point?.p))
    .sort((a, b) => a.t - b.t);
  return points.filter((point, index) => points[index + 1]?.t !== point.t);
}

/** Reads the last recorded step at each shared sample time. */
function sample(points: FeatureHistoryPoint[], start: number, end: number): number[] {
  let cursor = 0;
  return Array.from({ length: INTERVALS + 1 }, (_, index) => {
    const t = start + ((end - start) * index) / INTERVALS;
    while (cursor + 1 < points.length && points[cursor + 1].t <= t) cursor += 1;
    return points[cursor].p;
  });
}

/** Pearson correlation of movements, mapped from [-1, 1] into [0, 1]. */
function score(btcHistory: FeatureHistoryPoint[], coinHistory: FeatureHistoryPoint[]): number | undefined {
  const btc = ordered(btcHistory);
  const coin = ordered(coinHistory);
  if (btc.length < 3 || coin.length < 3) return undefined;

  const start = Math.max(btc[0].t, coin[0].t);
  const end = Math.max(btc.at(-1)!.t, coin.at(-1)!.t);
  if (end <= start ||
    btc.filter((point) => point.t > start).length < 2 ||
    coin.filter((point) => point.t > start).length < 2) return undefined;

  const btcValues = sample(btc, start, end);
  const coinValues = sample(coin, start, end);
  const btcMoves: number[] = [];
  const coinMoves: number[] = [];
  for (let index = MOVEMENT_LAG; index < btcValues.length; index += 1) {
    btcMoves.push(btcValues[index] - btcValues[index - MOVEMENT_LAG]);
    coinMoves.push(coinValues[index] - coinValues[index - MOVEMENT_LAG]);
  }

  const btcMean = btcMoves.reduce((sum, value) => sum + value, 0) / btcMoves.length;
  const coinMean = coinMoves.reduce((sum, value) => sum + value, 0) / coinMoves.length;
  let covariance = 0;
  let btcVariance = 0;
  let coinVariance = 0;
  for (let index = 0; index < btcMoves.length; index += 1) {
    const x = btcMoves[index] - btcMean;
    const y = coinMoves[index] - coinMean;
    covariance += x * y;
    btcVariance += x * x;
    coinVariance += y * y;
  }
  if (btcVariance <= 1e-12 || coinVariance <= 1e-12) return undefined;
  const correlation = covariance / Math.sqrt(btcVariance * coinVariance);
  return Math.max(0, Math.min(1, (correlation + 1) / 2));
}

const movementCorrelation = { score } as const;
export default movementCorrelation;
