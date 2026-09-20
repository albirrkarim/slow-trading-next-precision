import { fetchKlinesFunction } from "@/lib/datasets";
import type { FetchKlinesFunctionProps } from "@/lib/datasets/type";
import type { Kline } from "@/lib/exchange/types";
import { resolveMarketTypeForTradingMode } from "@/lib/exchange/utils";
import slowTradingShared from "@/lib/slowTrading/shared";
import fs from "fs-extra";
import path from "path";
import type { BacktestPrecisionParams } from "../api/precision-api-types";

const DATASET_FOLDER = "storage/datasets/PRECISION_BACKTEST/1m";
const DAY_MS = 24 * 60 * 60_000;
const FIVE_MINUTES_MS = 5 * 60_000;
const MINUTE_MS = 60_000;

type DatasetInterval = "1m" | "5m";

export interface PrecisionDataset {
  endTime: number;
  getKlines(props: FetchKlinesFunctionProps): Promise<Kline[]>;
  startTime: number;
  symbols: string[];
}

function normalizeDatasetSymbol(symbol: string): string {
  return symbol
    .trim()
    .toUpperCase()
    .replace(/_?USDT$/, "");
}

function getDayStart(time: number): number {
  return Math.floor(time / DAY_MS) * DAY_MS;
}

function getDayKey(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

function getDayFile(symbol: string, time: number): string {
  return path.resolve(DATASET_FOLDER, symbol, `${getDayKey(time)}.json`);
}

/** Resolves the requested backtest range without allocating candle data. */
function resolveBacktestRange(params: BacktestPrecisionParams): {
  endTime: number;
  startTime: number;
} {
  if (params.startTime !== undefined && params.endTime !== undefined) {
    return { endTime: params.endTime, startTime: params.startTime };
  }

  const match = params.range.match(
    /^(\d+)(minute|hour|day|week|month|year)$/,
  );
  if (!match) {
    throw new Error(
      "A precision backtest requires a supported range or explicit startTime and endTime.",
    );
  }

  const unitMinutes: Record<string, number> = {
    day: 1_440,
    hour: 60,
    minute: 1,
    month: 43_200,
    week: 10_080,
    year: 525_600,
  };
  const endTime = Date.now();
  const minutes = Number(match[1]) * unitMinutes[match[2]];

  return { endTime, startTime: endTime - minutes * MINUTE_MS };
}

function hasRequestedCoverage(
  klines: Kline[],
  startTime: number,
  endTime: number,
): boolean {
  if (klines.length === 0) return true;

  const expectedFirstOpenTime = Math.ceil(startTime / MINUTE_MS) * MINUTE_MS;
  const expectedLastOpenTime =
    Math.floor((endTime - 1) / MINUTE_MS) * MINUTE_MS;

  return (
    klines[0][0] <= expectedFirstOpenTime &&
    (klines.at(-1)?.[0] ?? 0) >= expectedLastOpenTime
  );
}

/** Downloads missing daily 1m files for one symbol without retaining its range. */
async function prepareSymbolDays(
  params: BacktestPrecisionParams,
  symbol: string,
  startTime: number,
  endTime: number,
): Promise<{ endTime: number; startTime: number }> {
  const marketType = resolveMarketTypeForTradingMode(
    params.config.management.tradingMode,
  );
  let firstOpenTime = Number.POSITIVE_INFINITY;
  let lastCloseTime = Number.NEGATIVE_INFINITY;

  for (
    let dayStart = getDayStart(startTime);
    dayStart < endTime;
    dayStart += DAY_MS
  ) {
    const requestStartTime = dayStart;
    const requestEndTime = Math.min(dayStart + DAY_MS, endTime);
    const file = getDayFile(symbol, dayStart);
    let klines: Kline[] | undefined;

    if (!params.upToDateKlines && (await fs.pathExists(file))) {
      const cached = (await fs.readJson(file)) as Kline[];
      if (hasRequestedCoverage(cached, requestStartTime, requestEndTime)) {
        klines = cached;
      }
    }

    if (!klines) {
      klines = await fetchKlinesFunction({
        endTime: requestEndTime - 1,
        exactDate: true,
        exchangeType: params.config.management.exchangeType,
        interval: "1m",
        marketType,
        saveToFile: false,
        startTime: requestStartTime,
        symbol: `${symbol}_USDT`,
        verbose: Boolean(params.verbose),
      });

      await fs.ensureDir(path.dirname(file));
      await fs.writeJson(file, klines);
    }

    const first = klines[0];
    const last = klines.at(-1);
    if (first) firstOpenTime = Math.min(firstOpenTime, first[0]);
    if (last) lastCloseTime = Math.max(lastCloseTime, last[6]);
  }

  if (!Number.isFinite(firstOpenTime) || !Number.isFinite(lastCloseTime)) {
    throw new Error(`No 1m klines found for ${symbol}.`);
  }

  return { endTime: lastCloseTime + 1, startTime: firstOpenTime };
}

function sumKlineField(klines: Kline[], index: 5 | 7 | 8 | 9 | 10): number {
  let total = 0;
  for (const kline of klines) total += Number(kline[index]) || 0;
  return total;
}

/** Aggregates complete UTC-aligned groups of five 1m candles. */
function aggregateFiveMinuteKlines(klines: Kline[]): Kline[] {
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

/** Selects completed candles from a sorted day without scanning the whole file. */
function sliceClosedKlines(
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

function resolveRequestRange(props: FetchKlinesFunctionProps): {
  endTime: number;
  startTime: number;
} {
  const endTime = props.endTime ?? Date.now();
  if (props.minutes !== undefined) {
    return { endTime, startTime: endTime - props.minutes * MINUTE_MS };
  }
  if (props.startTime !== undefined) {
    return { endTime, startTime: props.startTime };
  }
  throw new Error("Precision dataset requests require minutes or startTime.");
}

/** Creates a disk-backed dataset that caches the current day and day boundary. */
function createDatasetReader(symbols: string[]): Pick<
  PrecisionDataset,
  "getKlines"
> {
  const cache = new Map<string, Kline[]>();
  const maxCachedDays = Math.max(4, symbols.length * 2);

  const readDay = async (symbol: string, dayStart: number) => {
    const key = `${symbol}:${dayStart}`;
    const cached = cache.get(key);
    if (cached) {
      cache.delete(key);
      cache.set(key, cached);
      return cached;
    }

    const file = getDayFile(symbol, dayStart);
    if (!(await fs.pathExists(file))) {
      throw new Error(
        `Precision dataset is missing ${symbol} ${getDayKey(dayStart)}.`,
      );
    }
    const klines = (await fs.readJson(file)) as Kline[];
    cache.set(key, klines);
    while (cache.size > maxCachedDays) {
      const oldestKey = cache.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      cache.delete(oldestKey);
    }
    return klines;
  };

  return {
    async getKlines(props) {
      if (props.interval !== "1m" && props.interval !== "5m") {
        throw new Error(`Precision backtest has no ${props.interval} dataset.`);
      }

      const interval = props.interval as DatasetInterval;
      const symbol = normalizeDatasetSymbol(props.symbol);
      if (!symbols.includes(symbol)) {
        throw new Error(`Precision backtest has no dataset for ${symbol}.`);
      }
      const { endTime, startTime } = resolveRequestRange(props);
      const result: Kline[] = [];
      const firstFiveMinuteBucketStart =
        Math.floor(startTime / FIVE_MINUTES_MS) * FIVE_MINUTES_MS;

      for (
        let dayStart = getDayStart(startTime);
        dayStart <= getDayStart(Math.max(startTime, endTime - 1));
        dayStart += DAY_MS
      ) {
        const oneMinuteKlines = await readDay(symbol, dayStart);
        const visibleOneMinuteKlines = sliceClosedKlines(
          oneMinuteKlines,
          interval === "1m" ? startTime : firstFiveMinuteBucketStart,
          endTime,
        );
        const intervalKlines =
          interval === "1m"
            ? visibleOneMinuteKlines
            : aggregateFiveMinuteKlines(visibleOneMinuteKlines);

        for (const kline of intervalKlines) {
          if (kline[0] >= startTime) result.push(kline);
        }
      }

      return result;
    },
  };
}

/** Downloads only daily 1m files and returns their disk-backed adapter. */
export async function preparePrecisionDataset(
  params: BacktestPrecisionParams,
): Promise<PrecisionDataset> {
  const symbols = slowTradingShared.symbols.buildExecution(
    params.config.management.symbols,
  );
  const requestedRange = resolveBacktestRange(params);
  let startTime = requestedRange.startTime;
  let endTime = requestedRange.endTime;

  for (const symbol of symbols) {
    const bounds = await prepareSymbolDays(
      params,
      symbol,
      requestedRange.startTime,
      requestedRange.endTime,
    );
    startTime = Math.max(startTime, bounds.startTime);
    endTime = Math.min(endTime, bounds.endTime);
  }

  const reader = createDatasetReader(symbols);
  return { ...reader, endTime, startTime, symbols };
}
