import { detectVolatilityPoints } from "@/lib/dynamic";
import slowTradingShared from "@/lib/slowTrading/shared";
import type { RuntimeEngineAdapter, RuntimeEngineState } from "../types";
import type { RuntimeMarketHelper, RuntimeMarketInterval } from "./types";

const MARK_PRICE_LOOKBACK_MINUTES = 30;
const VPOINT_INITIAL_LOOKBACK_MINUTES = 60 * 24 * 30 * 2;

/** Binds reusable market-state updates to one runtime state and adapter. */
function create(
  state: RuntimeEngineState,
  adapter: RuntimeEngineAdapter,
): RuntimeMarketHelper {
  const markPriceUpdatedAt: Partial<Record<RuntimeMarketInterval, number>> = {};
  const vPointsUpdatedAt: Partial<Record<RuntimeMarketInterval, number>> = {};
  const getSymbols = () =>
    slowTradingShared.symbols.buildExecution(state.config.management.symbols);

  return {
    /**
     * We will update the this.state.markPriceMap
     *
     * in this so later the child will be just accessing the context.state.markPriceMap
     * so letting know the latest price.
     */
    async updateMarkPrice(interval = "5m") {
      const currentTime = state.currentTime;
      if (markPriceUpdatedAt[interval] === currentTime) return;

      const entries = await Promise.all(
        getSymbols().map(async (symbol) => {
          const klines = await adapter.market.getKlines({
            endTime: currentTime,
            interval,
            minutes: MARK_PRICE_LOOKBACK_MINUTES,
            symbol: `${symbol}_USDT`,
          });
          const latestClosedKline = klines.findLast(
            (kline) => kline[6] <= currentTime,
          );

          if (!latestClosedKline) {
            throw new Error(
              `No closed ${interval} kline found for ${symbol} at ${currentTime}.`,
            );
          }

          const price = Number(latestClosedKline[4]);
          if (!Number.isFinite(price)) {
            throw new Error(
              `Invalid ${interval} mark price for ${symbol} at ${currentTime}.`,
            );
          }

          return [
            symbol,
            { lastUpdated: latestClosedKline[6], price },
          ] as const;
        }),
      );

      Object.assign(state.markPriceMap, Object.fromEntries(entries));
      markPriceUpdatedAt[interval] = currentTime;
    },

    /**
     * Trying to keep the this.state.vPointsMap updated.
     *
     *  when speedup stage we use the 1m klines
     *  when usual condition we use the 5m klines
     */
    async updateVPointsMap(interval = "5m") {
      const currentTime = state.currentTime;
      if (vPointsUpdatedAt[interval] === currentTime) return;

      const entries = await Promise.all(
        getSymbols().map(async (symbol) => {
          const previousPoints = state.vPointsMap[symbol] ?? [];
          const previousPoint = previousPoints.at(-1);
          const startTime =
            previousPoint?.t ??
            currentTime - VPOINT_INITIAL_LOOKBACK_MINUTES * 60_000;
          const klines = await adapter.market.getKlines({
            endTime: currentTime,
            exactDate: true,
            interval,
            startTime,
            symbol: `${symbol}_USDT`,
          });
          const closedKlines = klines.filter(
            (kline) => kline[6] <= currentTime,
          );
          const newPoints = detectVolatilityPoints({
            klines: closedKlines,
            symbol,
            vPointBefore: previousPoint,
          }).filter((point) => !previousPoint || point.t > previousPoint.t);

          return [symbol, [...previousPoints, ...newPoints]] as const;
        }),
      );

      Object.assign(state.vPointsMap, Object.fromEntries(entries));
      vPointsUpdatedAt[interval] = currentTime;
    },
  };
}

const market = { create } as const;

export default market;
