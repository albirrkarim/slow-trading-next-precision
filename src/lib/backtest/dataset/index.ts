import fs from "fs-extra";
import path from "path";

import type { ExchangeType } from "@/lib/exchange";
import type { Kline } from "@/lib/exchange/platform/tokocrypto";
import { INTERVAL_MS_MAP } from "@/lib/exchange/platform/tokocrypto";
import { fetchKlinesFunction } from "@/lib/datasets/fetchKlines";
import type {
  BacktestDatasetInterval,
  BacktestDatasetKlines,
  BacktestDatasetSummary,
  BacktestDatasetV1,
} from "./types";

/** Root folder for persisted backtest datasets. */
export const BACKTEST_DATASET_ROOT = "storage/backtest-dataset";

const DATASET_INTERVALS: BacktestDatasetInterval[] = ["1m", "5m"];

/** Normalizes a symbol into the dataset's uppercase form. */
function normalizeSymbol(symbol: string): string {
  return String(symbol || "")
    .trim()
    .toUpperCase()
    .replace(/_USDT$/, "");
}

/** Returns the open time of one kline. */
function openTime(kline: Kline): number {
  return kline[0];
}

/** Returns the close time of one kline. */
function closeTime(kline: Kline): number {
  return kline[6];
}

/** Throws a descriptive error when one kline series is not contiguous. */
function assertContiguousSeries(params: {
  interval: BacktestDatasetInterval;
  klines: Kline[];
  startTime: number;
  endTime: number;
  symbol: string;
}): void {
  const { interval, klines, startTime, endTime, symbol } = params;
  const intervalMs = INTERVAL_MS_MAP[interval];

  if (klines.length === 0) {
    throw new Error(
      `Backtest dataset for ${symbol} ${interval} is empty over [${startTime}, ${endTime}]`,
    );
  }

  const first = openTime(klines[0]);
  const last = closeTime(klines[klines.length - 1]);
  if (first > startTime || last < endTime) {
    throw new Error(
      `Backtest dataset for ${symbol} ${interval} covers [${first}, ${last}] but the run requires [${startTime}, ${endTime}]`,
    );
  }

  for (let index = 1; index < klines.length; index += 1) {
    const previous = openTime(klines[index - 1]);
    const current = openTime(klines[index]);
    if (current === previous) {
      throw new Error(
        `Backtest dataset for ${symbol} ${interval} has a duplicate candle at ${current}`,
      );
    }
    if (current < previous) {
      throw new Error(
        `Backtest dataset for ${symbol} ${interval} is reversed at ${current}`,
      );
    }
    if (current - previous !== intervalMs) {
      throw new Error(
        `Backtest dataset for ${symbol} ${interval} has a gap between ${previous} and ${current}`,
      );
    }
  }
}

/** Validates the complete shape and candle coverage of one dataset. */
export function validateBacktestDataset(
  value: unknown,
): BacktestDatasetV1 {
  const dataset = value as BacktestDatasetV1;
  if (
    !dataset ||
    dataset.schema !== 1 ||
    !Array.isArray(dataset.symbols) ||
    dataset.symbols.length === 0 ||
    !Number.isFinite(dataset.warmupStartTime) ||
    !Number.isFinite(dataset.startTime) ||
    !Number.isFinite(dataset.endTime) ||
    !(dataset.warmupStartTime < dataset.startTime) ||
    !(dataset.startTime < dataset.endTime) ||
    !dataset.klines
  ) {
    throw new Error("Invalid backtest dataset file");
  }

  if (!dataset.symbols.includes("BTC")) {
    throw new Error("Backtest dataset must include BTC candles");
  }

  for (const symbol of dataset.symbols) {
    const series = dataset.klines[symbol];
    if (!series) {
      throw new Error(`Backtest dataset is missing ${symbol}`);
    }
    for (const interval of DATASET_INTERVALS) {
      const klines = series[interval];
      if (!Array.isArray(klines)) {
        throw new Error(`Backtest dataset is missing ${symbol} ${interval}`);
      }
      // TC: BTEST:BACKTEST_DATASET
      assertContiguousSeries({
        interval,
        klines,
        startTime: dataset.warmupStartTime,
        endTime: dataset.endTime,
        symbol,
      });
    }
  }

  return dataset;
}

/** Returns the klines of one symbol and interval visible at logical time. */
export function visibleKlines(
  dataset: BacktestDatasetV1,
  symbol: string,
  interval: BacktestDatasetInterval,
  throughTime: number,
): Kline[] {
  const series = dataset.klines[normalizeSymbol(symbol)]?.[interval] ?? [];
  // TC: BOTH:BACKTEST_CANDLE_VISIBILITY
  const visible = series.filter((kline) => closeTime(kline) <= throughTime);
  if (visible.length === 0) {
    throw new Error(
      `No ${symbol} ${interval} candles are visible at ${throughTime}; the dataset starts at ${dataset.warmupStartTime}`,
    );
  }

  return visible;
}

/** Builds one dataset by downloading klines once for every symbol. */
export async function buildBacktestDataset(params: {
  symbols: string[];
  startTime: number;
  endTime: number;
  /** Kline history kept before startTime for warmup. Default 30 days. */
  warmupMs?: number;
  sourceExchangeType?: ExchangeType;
  marketType?: "SPOT" | "FUTURES";
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}): Promise<BacktestDatasetV1> {
  const symbols = Array.from(
    new Set(
      [...params.symbols, "BTC"].map(normalizeSymbol).filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right));
  const warmupMs = params.warmupMs ?? 30 * 24 * 60 * 60_000;
  const warmupStartTime = params.startTime - warmupMs;
  const marketType = params.marketType ?? "FUTURES";
  const sourceExchangeType = params.sourceExchangeType ?? "binance";
  const klines: Record<string, BacktestDatasetKlines> = {};

  for (const symbol of symbols) {
    const series: BacktestDatasetKlines = { "1m": [], "5m": [] };
    for (const interval of DATASET_INTERVALS) {
      params.signal?.throwIfAborted();
      params.onProgress?.(
        `Downloading ${symbol} ${interval} klines from ${new Date(warmupStartTime).toISOString()} to ${new Date(params.endTime).toISOString()}`,
      );
      series[interval] = await fetchKlinesFunction({
        symbol: `${symbol}_USDT`,
        interval,
        startTime: warmupStartTime,
        endTime: params.endTime,
        exchangeType: sourceExchangeType,
        exchangeTypeForce: true,
        marketType,
        useCache: true,
        verbose: false,
        signal: params.signal,
      });
    }
    klines[symbol] = series;
  }

  const dataset: BacktestDatasetV1 = {
    schema: 1,
    sourceExchangeType,
    marketType,
    warmupStartTime,
    startTime: params.startTime,
    endTime: params.endTime,
    symbols,
    klines,
  };

  return validateBacktestDataset(dataset);
}

/** Resolves one dataset file name inside the dataset root safely. */
function resolveDatasetPath(fileName: string): string {
  const root = path.resolve(BACKTEST_DATASET_ROOT);
  const resolved = path.resolve(root, fileName);
  if (
    !fileName.endsWith(".json") ||
    resolved === root ||
    !resolved.startsWith(`${root}${path.sep}`)
  ) {
    throw new Error("Invalid backtest dataset file name");
  }

  return resolved;
}

/** Persists one dataset atomically and returns its file name. */
export async function writeBacktestDataset(
  dataset: BacktestDatasetV1,
): Promise<string> {
  validateBacktestDataset(dataset);
  const fileName = [
    dataset.symbols.join("-").toLowerCase(),
    dataset.startTime,
    dataset.endTime,
  ].join("_");
  const filePath = resolveDatasetPath(`${fileName}.json`);
  await fs.ensureDir(path.dirname(filePath));
  await fs.writeJSON(filePath, dataset);

  return path.basename(filePath);
}

/** Reads and validates one persisted dataset. */
export async function readBacktestDataset(
  fileName: string,
): Promise<BacktestDatasetV1> {
  return validateBacktestDataset(
    await fs.readJSON(resolveDatasetPath(fileName)),
  );
}

/** Lists persisted dataset summaries newest-first. */
export async function listBacktestDatasets(): Promise<
  BacktestDatasetSummary[]
> {
  await fs.ensureDir(BACKTEST_DATASET_ROOT);
  const summaries: BacktestDatasetSummary[] = [];
  for (const fileName of await fs.readdir(BACKTEST_DATASET_ROOT)) {
    if (!fileName.endsWith(".json")) {
      continue;
    }
    const dataset = await readBacktestDataset(fileName);
    summaries.push({
      fileName,
      sourceExchangeType: dataset.sourceExchangeType,
      marketType: dataset.marketType,
      warmupStartTime: dataset.warmupStartTime,
      startTime: dataset.startTime,
      endTime: dataset.endTime,
      symbols: dataset.symbols,
    });
  }

  return summaries.sort((left, right) => right.startTime - left.startTime);
}

const slowTradingBacktestDataset = {
  build: buildBacktestDataset,
  list: listBacktestDatasets,
  read: readBacktestDataset,
  validate: validateBacktestDataset,
  visible: {
    klines: visibleKlines,
  },
  write: writeBacktestDataset,
} as const;

export default slowTradingBacktestDataset;
export { slowTradingBacktestDataset };
export type {
  BacktestDatasetInterval,
  BacktestDatasetKlines,
  BacktestDatasetSummary,
  BacktestDatasetV1,
} from "./types";
