import { TradingMode } from "@/lib/exchange";
import type { ExchangeType, Kline } from "@/lib/exchange/types";
import { MARK_PRICE_LOOKBACK_MINUTES } from "@/lib/precision/constant";
import type { FetchKlinesParams, MarketType } from "@/lib/system/types";
import klineUtils from "@/lib/system/utils/klines";
import {
  aggregateFiveMinuteKlines,
  FIVE_MINUTES_MS,
  MINUTE_MS,
  normalizeDatasetSymbol,
  sliceClosedKlines,
} from "../klines";

export interface QuickBacktestDataset {
  endTime: number;
  getKlines(props: FetchKlinesParams): Promise<Kline[]>;
  startTime: number;
  symbols: string[];
}

function toMarketType(tradingMode: TradingMode): MarketType {
  return tradingMode === TradingMode.FUTURES ? "FUTURES" : "SPOT";
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
  throw new Error("Quick backtest dataset requests require minutes or startTime.");
}

/**
 * Downloads the whole requested window once per symbol and serves the
 * runtime's kline reads from memory. `dataStartTimeBySymbol` may extend the
 * fetched window backwards (mark-price lookback and the detector's seeded
 * continuation point) without changing the reported simulation range.
 */
export async function prepareQuickBacktestDataset({
  dataStartTimeBySymbol = {},
  endTime,
  exchangeType,
  range,
  signal,
  startTime,
  symbols,
  tradingMode,
}: {
  dataStartTimeBySymbol?: Record<string, number>;
  endTime?: number;
  exchangeType: ExchangeType;
  range?: string;
  signal?: AbortSignal;
  startTime?: number;
  symbols: string[];
  tradingMode: TradingMode;
}): Promise<QuickBacktestDataset> {
  const requestedRange = klineUtils.resolveRange({ endTime, range, startTime });
  const marketType = toMarketType(tradingMode);
  const klinesBySymbol = new Map<string, Kline[]>();
  let boundedStart = requestedRange.startTime;
  let boundedEnd = requestedRange.endTime;

  for (const symbol of symbols) {
    if (signal?.aborted) {
      throw new Error("Quick backtest aborted.");
    }

    const fetchStart = Math.min(
      requestedRange.startTime - MARK_PRICE_LOOKBACK_MINUTES * MINUTE_MS,
      dataStartTimeBySymbol[symbol] ?? Number.POSITIVE_INFINITY,
    );
    const downloaded = await klineUtils.downloadRange({
      endTime: requestedRange.endTime,
      exchangeType,
      marketType,
      startTime: fetchStart,
      symbol: `${symbol}_USDT`,
      tradingMode,
    });

    if (downloaded.length === 0) {
      throw new Error(`No 1m klines found for ${symbol}.`);
    }

    klinesBySymbol.set(symbol, downloaded);
    boundedStart = Math.max(boundedStart, downloaded[0][0]);
    boundedEnd = Math.min(boundedEnd, (downloaded.at(-1)?.[6] ?? 0) + 1);
  }

  return {
    endTime: boundedEnd,
    startTime: boundedStart,
    symbols,
    async getKlines(props) {
      if (props.interval !== "1m" && props.interval !== "5m") {
        throw new Error(`Quick backtest has no ${props.interval} dataset.`);
      }

      const symbol = normalizeDatasetSymbol(props.symbol);
      const symbolKlines = klinesBySymbol.get(symbol);
      if (!symbolKlines) {
        throw new Error(`Quick backtest has no dataset for ${symbol}.`);
      }

      const { endTime: requestEnd, startTime: requestStart } =
        resolveRequestRange(props);
      const firstFiveMinuteBucketStart =
        Math.floor(requestStart / FIVE_MINUTES_MS) * FIVE_MINUTES_MS;
      const visibleOneMinuteKlines = sliceClosedKlines(
        symbolKlines,
        props.interval === "1m" ? requestStart : firstFiveMinuteBucketStart,
        requestEnd,
      );
      const intervalKlines =
        props.interval === "1m"
          ? visibleOneMinuteKlines
          : aggregateFiveMinuteKlines(visibleOneMinuteKlines);

      return intervalKlines.filter((kline) => kline[0] >= requestStart);
    },
  };
}
