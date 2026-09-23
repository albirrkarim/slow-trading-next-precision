import type { Kline } from "@/lib/exchange/types";

export const MINUTE_MS = 60_000;
export const FIVE_MINUTES_MS = 5 * MINUTE_MS;
export const DAY_MS = 24 * 60 * MINUTE_MS;

/** Strips quote suffixes and case so datasets key by the base coin. */
export function normalizeDatasetSymbol(symbol: string): string {
  return symbol
    .trim()
    .toUpperCase()
    .replace(/_?USDT$/, "");
}

export function getDayStart(time: number): number {
  return Math.floor(time / DAY_MS) * DAY_MS;
}

export function getDayKey(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

/** Dedupes klines by open time and sorts them ascending. */
export function mergeKlines(cached: Kline[], downloaded: Kline[]): Kline[] {
  const byOpenTime = new Map<number, Kline>();
  for (const kline of cached) byOpenTime.set(kline[0], kline);
  for (const kline of downloaded) byOpenTime.set(kline[0], kline);
  return [...byOpenTime.values()].sort((left, right) => left[0] - right[0]);
}

/** Selects completed candles from a sorted range without scanning everything. */
export function sliceClosedKlines(
  klines: Kline[],
  startTime: number,
  endTime: number,
): Kline[] {
  let low = 0;
  let high = klines.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (klines[middle][0] < startTime) low = middle + 1;
    else high = middle;
  }
  const startIndex = low;

  low = startIndex;
  high = klines.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (klines[middle][6] <= endTime) low = middle + 1;
    else high = middle;
  }

  return klines.slice(startIndex, low);
}

function sumKlineField(klines: Kline[], index: 5 | 7 | 8 | 9 | 10): number {
  let total = 0;
  for (const kline of klines) total += Number(kline[index]) || 0;
  return total;
}

/** Aggregates complete UTC-aligned groups of five 1m candles. */
export function aggregateFiveMinuteKlines(klines: Kline[]): Kline[] {
  const result: Kline[] = [];
  let bucket: Kline[] = [];
  let bucketStart = -1;

  const flush = () => {
    if (bucket.length !== 5 || bucket[0][0] !== bucketStart) {
      bucket = [];
      return;
    }

    for (let index = 1; index < bucket.length; index++) {
      if (bucket[index][0] !== bucket[index - 1][0] + MINUTE_MS) {
        bucket = [];
        return;
      }
    }

    const first = bucket[0];
    const last = bucket[4];
    result.push([
      bucketStart,
      first[1],
      String(Math.max(...bucket.map((kline) => Number(kline[2])))),
      String(Math.min(...bucket.map((kline) => Number(kline[3])))),
      last[4],
      String(sumKlineField(bucket, 5)),
      last[6],
      String(sumKlineField(bucket, 7)),
      sumKlineField(bucket, 8),
      String(sumKlineField(bucket, 9)),
      String(sumKlineField(bucket, 10)),
      last[11],
      new Date(bucketStart).toISOString(),
    ]);
    bucket = [];
  };

  for (const kline of klines) {
    const nextBucketStart =
      Math.floor(kline[0] / FIVE_MINUTES_MS) * FIVE_MINUTES_MS;
    if (bucketStart !== nextBucketStart) {
      if (bucket.length > 0) flush();
      bucketStart = nextBucketStart;
    }
    bucket.push(kline);
  }
  if (bucket.length > 0) flush();

  return result;
}
