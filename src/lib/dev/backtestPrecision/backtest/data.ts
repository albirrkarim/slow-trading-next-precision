import { TradingMode } from "@/lib/exchange";
import type { Kline } from "@/lib/exchange/types";
import type { FetchKlinesParams, MarketType } from "@/lib/system/types";
import entry from "@/lib/system/trading/entry";
import fs from "fs-extra";
import path from "path";
import type { BacktestPrecisionParams } from "../api/precision-api-types";
import klineUtils from "@/lib/system/utils/klines";
import {
  aggregateFiveMinuteKlines,
  DAY_MS,
  FIVE_MINUTES_MS,
  getDayKey,
  getDayStart,
  mergeKlines,
  MINUTE_MS,
  normalizeDatasetSymbol,
  sliceClosedKlines,
} from "../../klines";

const DATASET_FOLDER = "storage/datasets/PRECISION_BACKTEST/1m";

type DatasetInterval = "1m" | "5m";

export interface PrecisionDataset {
  endTime: number;
  getKlines(props: FetchKlinesParams): Promise<Kline[]>;
  startTime: number;
  symbols: string[];
}

function getDayFile(symbol: string, time: number): string {
  return path.resolve(DATASET_FOLDER, symbol, `${getDayKey(time)}.json`);
}

/** Maps the configured trading mode to the exchange market type. */
// BTEST:BACKTEST_MARKET_TYPE — futures runs fetch Futures klines, spot runs
// fetch Spot klines; datasets stay market-specific.
function resolveMarketType(params: BacktestPrecisionParams): MarketType {
  return params.config.management.tradingMode === "futures"
    ? "FUTURES"
    : "SPOT";
}

/** Downloads missing daily 1m files for one symbol without retaining its range. */
async function prepareSymbolDays(
  params: BacktestPrecisionParams,
  symbol: string,
  startTime: number,
  endTime: number,
): Promise<{ endTime: number; startTime: number }> {
  const marketType = resolveMarketType(params);
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
    const fileExists = await fs.pathExists(file);
    let klines = fileExists ? ((await fs.readJson(file)) as Kline[]) : [];
    const expectedLastOpenTime =
      Math.floor((requestEndTime - 1) / MINUTE_MS) * MINUTE_MS;
    const cachedLastOpenTime = klines.at(-1)?.[0];
    const isCurrentDay = dayStart === getDayStart(Date.now());
    const needsDownload =
      !fileExists ||
      (cachedLastOpenTime !== undefined &&
        cachedLastOpenTime < expectedLastOpenTime) ||
      (klines.length === 0 && isCurrentDay) ||
      (isCurrentDay && params.upToDateKlines);

    if (needsDownload) {
      const downloaded = await klineUtils.downloadRange({
        endTime: requestEndTime - 1,
        exchangeType: params.config.management.exchangeType,
        marketType,
        startTime: cachedLastOpenTime ?? requestStartTime,
        symbol: `${symbol}_USDT`,
        tradingMode:
          params.config.management.tradingMode === "futures"
            ? TradingMode.FUTURES
            : TradingMode.SPOT,
      });
      klines = mergeKlines(klines, downloaded);

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

function resolveRequestRange(props: FetchKlinesParams): {
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

/**
 * Earliest disk-preparation time needed to rebuild a captured runtime state:
 * the mark-price lookback plus every retained initial vPoint.
 */
function resolveInitialStateDataStart(
  params: BacktestPrecisionParams,
): number | undefined {
  const initialState = params.initialState;
  if (!initialState) {
    return undefined;
  }
  if (!Number.isFinite(params.startTime)) {
    throw new Error(
      "Precision checker replay requires a finite startTime to prepare captured initial state data.",
    );
  }

  let start = (params.startTime as number) - 30 * 60_000;
  for (const points of Object.values(initialState.vPointsMap)) {
    for (const point of points) {
      if (Number.isFinite(point.t)) {
        start = Math.min(start, point.t);
      }
    }
  }
  return start;
}

/** Downloads only daily 1m files and returns their disk-backed adapter. */
export async function preparePrecisionDataset(
  params: BacktestPrecisionParams,
): Promise<PrecisionDataset> {
  const symbols = entry.getSymbols(params.config);
  const requestedRange = klineUtils.resolveRange({
    endTime: params.endTime,
    range: params.range,
    startTime: params.startTime,
  });
  const preparationStartTime = Math.min(
    requestedRange.startTime,
    resolveInitialStateDataStart(params) ?? requestedRange.startTime,
  );
  let startTime = requestedRange.startTime;
  let endTime = requestedRange.endTime;

  for (const symbol of symbols) {
    const bounds = await prepareSymbolDays(
      params,
      symbol,
      preparationStartTime,
      requestedRange.endTime,
    );
    startTime = Math.max(startTime, bounds.startTime);
    endTime = Math.min(endTime, bounds.endTime);
  }

  const reader = createDatasetReader(symbols);
  return { ...reader, endTime, startTime, symbols };
}
