import type { VolatilityPoint } from "@/lib/system/types";

/** Result of pairing production vs backtest vPoints inside the captured window. */
export interface VPointPairing {
  prodTotal: number;
  btTotal: number;
  prodPaired: number;
  btPaired: number;
  /** Production leftovers + backtest leftovers. */
  unpaired: number;
  pairCount: number;
  sumMinuteDiff: number;
  meanMinuteDiff: number | null;
}

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

function pairKey(point: VolatilityPoint): string {
  // symbol is implied by the map; dd-mm-yyyy-HH = one-hour time bucket.
  return `${point.lvl}|${point.l}|${Math.floor(point.t / HOUR_MS)}`;
}

function inWindow(
  points: VolatilityPoint[] | undefined,
  startTime: number,
  endTime: number,
) {
  return (points ?? []).filter((p) => p.t >= startTime && p.t <= endTime);
}

/**
 * Greedy one-to-one pairing of production and backtest vPoints.
 *
 * Two points pair when they share symbol, volatility level, T/B type, and
 * the same hour bucket (dd-mm-yyyy-HH); within a bucket the nearest
 * unconsumed backtest point wins. `meanMinuteDiff` is the mean absolute
 * time deviation across pairs — null when nothing paired.
 */
function pairVPoints(
  productionMap: Record<string, VolatilityPoint[]>,
  backtestMap: Record<string, VolatilityPoint[]>,
  startTime: number,
  endTime: number,
): VPointPairing {
  const symbols = new Set([
    ...Object.keys(productionMap),
    ...Object.keys(backtestMap),
  ]);

  let prodTotal = 0;
  let btTotal = 0;
  let prodPaired = 0;
  let btPaired = 0;
  let sumMinuteDiff = 0;

  for (const symbol of symbols) {
    const prod = inWindow(productionMap[symbol], startTime, endTime).sort(
      (a, b) => a.t - b.t,
    );
    const bt = inWindow(backtestMap[symbol], startTime, endTime);
    prodTotal += prod.length;
    btTotal += bt.length;

    const buckets = new Map<string, VolatilityPoint[]>();
    for (const point of bt) {
      const key = pairKey(point);
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.push(point);
      } else {
        buckets.set(key, [point]);
      }
    }

    for (const prodPoint of prod) {
      const bucket = buckets.get(pairKey(prodPoint));
      if (!bucket || bucket.length === 0) continue;

      let bestIdx = 0;
      let bestDiff = Math.abs(prodPoint.t - bucket[0].t);
      for (let i = 1; i < bucket.length; i++) {
        const diff = Math.abs(prodPoint.t - bucket[i].t);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestIdx = i;
        }
      }
      bucket.splice(bestIdx, 1);

      prodPaired++;
      btPaired++;
      sumMinuteDiff += bestDiff / MINUTE_MS;
    }
  }

  const pairCount = prodPaired;
  return {
    prodTotal,
    btTotal,
    prodPaired,
    btPaired,
    unpaired: prodTotal - prodPaired + (btTotal - btPaired),
    pairCount,
    sumMinuteDiff,
    meanMinuteDiff: pairCount > 0 ? sumMinuteDiff / pairCount : null,
  };
}

export default pairVPoints;
