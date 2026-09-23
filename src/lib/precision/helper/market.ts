import entry from "@/lib/system/trading/entry";

import type {
  RuntimeEngineAdapter,
  RuntimeEngineState,
  RuntimeVPointMemory,
} from "../types";
import {
  DEFAULT_RECENT_VPOINTS,
  MARK_PRICE_LOOKBACK_MINUTES,
  VPOINT_INITIAL_LOOKBACK_MINUTES,
} from "../constant";
import vpoints from "@/lib/system/utils/vpoints";
import type { RuntimeMarketHelper, RuntimeMarketInterval } from "./types";

interface VolatilityCursor {
  lastKnownPointId?: string;
  lastProcessedOpenTime: number;
  memory: RuntimeVPointMemory;
}

/** Binds reusable market-state updates to one runtime state and adapter. */
function create(
  state: RuntimeEngineState,
  adapter: RuntimeEngineAdapter,
): RuntimeMarketHelper {
  const markPriceUpdatedAt: Partial<Record<RuntimeMarketInterval, number>> = {};
  const vPointsUpdatedAt: Partial<Record<RuntimeMarketInterval, number>> = {};
  const volatilityCursors: Partial<
    Record<
      RuntimeMarketInterval,
      Record<string, VolatilityCursor | undefined>
    >
  > = {};
  const getSymbols = () =>
    entry.getSymbols(state.config);
  const marketType =
    state.config.management.tradingMode === "futures" ? "FUTURES" : "SPOT";

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

      const entries: Array<
        readonly [string, { lastUpdated: number; price: number }]
      > = [];

      for (const symbol of getSymbols()) {
        const klines = await adapter.market.getKlines({
          endTime: currentTime,
          interval,
          marketType,
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

        entries.push([
          symbol,
          { lastUpdated: latestClosedKline[6], price },
        ]);
      }

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

      const intervalCursors = (volatilityCursors[interval] ??= {});

      for (const symbol of getSymbols()) {
        const points = state.vPointsMap[symbol] ?? [];
        let previousPoint = points.at(-1);
        let cursor = intervalCursors[symbol];

        if (cursor?.lastKnownPointId !== previousPoint?.id) {
          cursor = undefined;
          delete intervalCursors[symbol];
        }

        const intervalMs = interval === "1m" ? 60_000 : 5 * 60_000;
        const startTime = cursor
          ? cursor.lastProcessedOpenTime + intervalMs
          : (previousPoint?.t ??
            currentTime - VPOINT_INITIAL_LOOKBACK_MINUTES * 60_000);


        const klines = await adapter.market.getKlines({
          endTime: currentTime,
          exactDate: true,
          interval,
          marketType,
          startTime,
          symbol: `${symbol}_USDT`,
        });
        const closedKlines = klines.filter(
          (kline) => kline[6] <= currentTime,
        );
        if (closedKlines.length === 0) continue;

        let memory =
          cursor?.memory ??
          vpoints.createMemory({
            firstClose:
              previousPoint?.p ?? Number(closedKlines[0][4]),
            firstTime: previousPoint?.t ?? closedKlines[0][0],
          });
        const firstIndex = cursor ? 0 : 1;

        for (let index = firstIndex; index < closedKlines.length; index++) {
          const predicted = vpoints.processKline({
            kline: closedKlines[index],
            memory,
            previousPoint,
            symbol,
          });
          memory = predicted.memory;
          if (!predicted.point) continue;

          points.push(predicted.point);
          previousPoint = predicted.point;
          await adapter.onNewVPoint?.(symbol, predicted.point);
        }

        intervalCursors[symbol] = {
          lastKnownPointId: previousPoint?.id,
          lastProcessedOpenTime: closedKlines.at(-1)?.[0] ?? startTime,
          memory,
        };
        // Bounds the runtime window to recent points plus anything open
        // positions still depend on; the full history lives in persisted
        // volatility files (production) or the adapter's buffers (backtest).
        state.vPointsMap[symbol] = vpoints.retainRecent({
          symbol,
          points,
          positions: state.openPositions,
          recent: adapter.retainRecentVPoints ?? DEFAULT_RECENT_VPOINTS,
        });
      }

      vPointsUpdatedAt[interval] = currentTime;
    },
  };
}

const market = { create } as const;

export default market;
