import { getExchange } from "@/lib/exchange";
import type { TradingMode } from "@/lib/exchange";
import { MAX_KLINES_PER_CALL } from "@/lib/exchange/constants";
import type {
  ExchangeType,
  IntervalKlines,
  Kline,
} from "@/lib/exchange/types";
import type { MarketType } from "../types";

const MINUTE_MS = 60_000;

const INTERVAL_UNIT_MS: Record<string, number> = {
  m: MINUTE_MS,
  h: 60 * MINUTE_MS,
  d: 24 * 60 * MINUTE_MS,
  w: 7 * 24 * 60 * MINUTE_MS,
  M: 30 * 24 * 60 * MINUTE_MS,
};

/** Converts an `IntervalKlines` value like "5m" or "1h" to milliseconds. */
function intervalToMs(interval: IntervalKlines): number {
  const match = interval.match(/^(\d+)(m|h|d|w|M)$/);
  if (!match) {
    throw new Error(`Unsupported kline interval: ${interval}`);
  }

  return Number(match[1]) * INTERVAL_UNIT_MS[match[2]];
}

const RANGE_UNIT_MINUTES: Record<string, number> = {
  day: 1_440,
  hour: 60,
  minute: 1,
  month: 43_200,
  week: 10_080,
  year: 525_600,
};

/** Resolves an explicit range or a `<n><unit>` shorthand to a bounded window. */
function resolveRange({
  endTime,
  range,
  startTime,
}: {
  endTime?: number;
  range?: string;
  startTime?: number;
}): { endTime: number; startTime: number } {
  if (startTime !== undefined && endTime !== undefined) {
    return {
      endTime: Math.floor(endTime / MINUTE_MS) * MINUTE_MS,
      startTime,
    };
  }

  const match = range?.match(/^(\d+)(minute|hour|day|week|month|year)$/);
  if (!match) {
    throw new Error(
      "A supported range or explicit startTime and endTime is required.",
    );
  }

  const resolvedEndTime = Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;
  const minutes = Number(match[1]) * RANGE_UNIT_MINUTES[match[2]];

  return {
    endTime: resolvedEndTime,
    startTime: resolvedEndTime - minutes * MINUTE_MS,
  };
}

/**
 * Downloads one bounded range straight from an exchange in
 * `MAX_KLINES_PER_CALL` batches, deduplicated and sorted by open time.
 * Keeps only candles fully inside the requested window
 * (open >= start, close <= end).
 */
async function downloadRange({
  closedOnly = true,
  endTime,
  exchangeType,
  interval = "1m",
  marketType,
  startTime,
  symbol,
  tradingMode,
}: {
  /** Keep only candles fully inside the window (drop the in-flight tail). */
  closedOnly?: boolean;
  endTime: number;
  exchangeType: ExchangeType;
  interval?: IntervalKlines;
  marketType?: MarketType;
  startTime: number;
  symbol: string;
  tradingMode?: TradingMode;
}): Promise<Kline[]> {
  // The legacy datasets downloader silently served OKX history requests with
  // binance candles; keep that behavior for identical datasets.
  const resolvedExchangeType =
    exchangeType === "okx" ? "binance" : exchangeType;
  const exchange = getExchange(resolvedExchangeType, {
    defaultTradingMode: tradingMode,
  });
  const maxPerCall = MAX_KLINES_PER_CALL[resolvedExchangeType];
  const resultByOpenTime = new Map<number, Kline>();
  const intervalMs = intervalToMs(interval);
  let cursor = startTime;

  while (cursor <= endTime) {
    const requestEnd = Math.min(endTime, cursor + intervalMs * maxPerCall - 1);
    const batch = await exchange.getKlines({
      endTime: requestEnd,
      interval,
      limit: maxPerCall,
      marketType,
      startTime: cursor,
      symbol,
    });

    for (const kline of batch) {
      if (
        kline[0] >= startTime &&
        (closedOnly ? kline[6] <= endTime : kline[0] <= endTime)
      ) {
        resultByOpenTime.set(kline[0], kline);
      }
    }

    const lastOpenTime = batch.at(-1)?.[0];
    cursor =
      typeof lastOpenTime === "number" && lastOpenTime >= cursor
        ? lastOpenTime + intervalMs
        : requestEnd + intervalMs;
  }

  return [...resultByOpenTime.values()].sort(
    (left, right) => left[0] - right[0],
  );
}

const klines = {
  downloadRange,
  intervalToMs,
  resolveRange,
} as const;

export default klines;
