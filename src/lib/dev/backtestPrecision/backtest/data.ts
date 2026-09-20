import { fetchKlinesFunction } from "@/lib/datasets";
import type { FetchKlinesFunctionProps } from "@/lib/datasets/type";
import type { Kline } from "@/lib/exchange/types";
import { resolveMarketTypeForTradingMode } from "@/lib/exchange/utils";
import slowTradingShared from "@/lib/slowTrading/shared";
import type { BacktestPrecisionParams } from "../api/precision-api-types";

const DATASET_FOLDER = "storage/datasets/PRECISION_BACKTEST";
const DATASET_INTERVALS = ["1m", "5m"] as const;

type DatasetInterval = (typeof DATASET_INTERVALS)[number];
type KlinesMap = Record<string, Kline[]>;

/** Builds the range arguments used to fetch or reuse a backtest dataset. */
function buildRangeProps(
  params: BacktestPrecisionParams,
): Pick<
  FetchKlinesFunctionProps,
  "endTime" | "exactDate" | "simpleTime" | "startTime"
> {
  if (params.startTime !== undefined && params.endTime !== undefined) {
    return {
      endTime: params.endTime,
      exactDate: true,
      startTime: params.startTime,
    };
  }

  if (params.range !== "custom") {
    return {
      exactDate: false,
      simpleTime: params.range,
    };
  }

  throw new Error(
    "A custom precision backtest range requires startTime and endTime.",
  );
}

/** Loads one raw candle interval for every symbol required by the runtime. */
export async function buildKlinesMap(
  params: BacktestPrecisionParams,
  interval: DatasetInterval,
): Promise<KlinesMap> {
  const symbols = slowTradingShared.symbols.buildExecution(
    params.config.management.symbols,
  );
  const marketType = resolveMarketTypeForTradingMode(
    params.config.management.tradingMode,
  );
  const rangeProps = buildRangeProps(params);

  const entries = await Promise.all(
    symbols.map(async (symbol) => {
      const klines = await fetchKlinesFunction({
        ...rangeProps,
        exchangeType: params.config.management.exchangeType,
        folder: `${DATASET_FOLDER}/${interval}`,
        interval,
        marketType,
        saveToFile: true,
        symbol: `${symbol}_USDT`,
        useCache: !params.upToDateKlines,
        verbose: Boolean(params.verbose),
      });

      if (klines.length === 0) {
        throw new Error(`No ${interval} klines found for ${symbol}.`);
      }

      return [symbol, klines] as const;
    }),
  );

  return Object.fromEntries(entries);
}

function normalizeDatasetSymbol(symbol: string): string {
  return symbol
    .trim()
    .toUpperCase()
    .replace(/_?USDT$/, "");
}

/** Reads klines only from the prepared dataset used by this backtest. */
export async function getDatasetKlines(
  props: FetchKlinesFunctionProps,
  maps: Record<DatasetInterval, KlinesMap>,
): Promise<Kline[]> {
  if (!DATASET_INTERVALS.includes(props.interval as DatasetInterval)) {
    throw new Error(`Precision backtest has no ${props.interval} dataset.`);
  }

  const interval = props.interval as DatasetInterval;
  const symbol = normalizeDatasetSymbol(props.symbol);
  const klines = maps[interval][symbol];

  if (!klines) {
    throw new Error(
      `Precision backtest has no ${interval} dataset for ${symbol}.`,
    );
  }

  if (
    props.simpleTime !== undefined ||
    props.minutes !== undefined ||
    props.startTime !== undefined ||
    props.endTime !== undefined
  ) {
    return fetchKlinesFunction({
      ...props,
      klines,
      saveToFile: false,
    });
  }

  return klines;
}

/** Finds the earliest candle without allocating or spreading intermediate arrays. */
export function getEarliestOpenTime(
  klinesMap: Record<string, Kline[]>,
): number {
  let earliestOpenTime = Number.POSITIVE_INFINITY;

  for (const symbol in klinesMap) {
    const openTime = klinesMap[symbol][0]?.[0];
    if (openTime !== undefined && openTime < earliestOpenTime) {
      earliestOpenTime = openTime;
    }
  }

  if (!Number.isFinite(earliestOpenTime)) {
    throw new Error("Precision backtest has no 1m klines.");
  }

  return earliestOpenTime;
}
