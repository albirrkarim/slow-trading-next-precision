import { MAX_KLINES_PER_CALL } from "@/lib/exchange/constants";
import type {
  IntervalKlines,
  Kline,
} from "@/lib/exchange/platform/tokocrypto";
import { INTERVAL_MS_MAP } from "@/lib/exchange/platform/tokocrypto";
import { simpleTimeToMinutes } from "@/lib/exchange/utils";
import type { RuntimeEngineAdapter } from "@/lib/precision/types";
import type { FetchKlinesParams } from "@/lib/system/types";
import type { ProductionAdapterOptions } from "./types";

function resolveEndTime(props: FetchKlinesParams, now: number): number {
  return props.endTime ?? now;
}

function resolveStartTime(
  props: FetchKlinesParams,
  endTime: number,
): number {
  if (props.startTime !== undefined) return props.startTime;

  const minutes =
    props.minutes ??
    (props.simpleTime ? simpleTimeToMinutes(props.simpleTime) : undefined);
  if (minutes !== undefined && minutes > 0) {
    return endTime - minutes * 60_000;
  }

  throw new Error(
    `Production kline request for ${props.symbol} needs startTime or a time window.`,
  );
}

function filterVisibleKlines(
  klines: Kline[],
  startTime: number,
  endTime: number,
): Kline[] {
  return klines.filter(
    (kline) => kline[0] >= startTime && kline[6] <= endTime,
  );
}

async function fetchKlinesInBatches(
  options: ProductionAdapterOptions,
  props: FetchKlinesParams,
  startTime: number,
  endTime: number,
): Promise<Kline[]> {
  const interval = (props.interval ?? "1m") as IntervalKlines;
  const intervalMs = INTERVAL_MS_MAP[interval];
  if (!intervalMs) {
    throw new Error(`Unsupported production kline interval: ${interval}.`);
  }

  const maxPerCall = MAX_KLINES_PER_CALL[options.exchange.exchangeType];
  const resultByOpenTime = new Map<number, Kline>();
  let cursor = startTime;

  while (cursor <= endTime) {
    options.signal?.throwIfAborted();
    const requestEnd = Math.min(
      endTime,
      cursor + intervalMs * maxPerCall - 1,
    );
    const batch = await options.exchange.getKlines({
      endTime: requestEnd,
      interval,
      limit: maxPerCall,
      marketType: props.marketType,
      startTime: cursor,
      symbol: props.symbol,
    });
    options.signal?.throwIfAborted();

    for (const kline of batch) {
      if (kline[0] >= startTime && kline[6] <= endTime) {
        resultByOpenTime.set(kline[0], kline);
      }
    }

    const lastOpenTime = batch.at(-1)?.[0];
    cursor =
      typeof lastOpenTime === "number" && lastOpenTime >= cursor
        ? lastOpenTime + intervalMs
        : requestEnd + intervalMs;
  }

  return [...resultByOpenTime.values()].sort((left, right) => left[0] - right[0]);
}

/** Adapts the exchange's bounded kline API to the runtime market contract. */
function createMarket(
  options: ProductionAdapterOptions,
): RuntimeEngineAdapter["market"] {
  return {
    async getKlines(props) {
      options.signal?.throwIfAborted();
      const endTime = resolveEndTime(props, options.clock.now());
      const startTime = resolveStartTime(props, endTime);
      const klines = await fetchKlinesInBatches(
        options,
        props,
        startTime,
        endTime,
      );

      return filterVisibleKlines(klines, startTime, endTime);
    },
  };
}

/**
 * Creates the production adapter without importing production concerns into
 * the shared precision runtime.
 */
function create(options: ProductionAdapterOptions): RuntimeEngineAdapter {
  const getBalance =
    options.getBalance ??
    (async () => {
      const balance = await options.exchange.getBalance("USDT_USDT");
      if (!balance) {
        throw new Error("Production exchange returned no USDT balance.");
      }
      return balance.quoteAsset;
    });

  return {
    clock: options.clock,
    exchange: {
      getBalance,
      getFeeRate({ side, type }) {
        return (
          options.exchange.getFees().getTotalFeePercent({
            currency: "USDT",
            side,
            type,
          }) / 100
        );
      },
      getRoundTripFeeRate({ type }) {
        return (
          options.exchange.getFees().getBothSideFeePercent({
            currency: "USDT",
            type,
          }) / 100
        );
      },
    },
    market: createMarket(options),
    onAction: options.onAction,
    onCycleComplete: options.onCycleComplete,
    onExit: options.onExit,
    onManagement: options.onManagement,
    onNewVPoint: options.onNewVPoint,
    onRiskSentinel: options.onRiskSentinel,
    onStageStats: options.onStageStats,
    onStateChange: options.onStateChange,
    onNotif: options.onNotif ?? (() => true),
    onStrategy: options.onStrategy,
  };
}

const adapter = { create } as const;

export default adapter;
export { adapter };
