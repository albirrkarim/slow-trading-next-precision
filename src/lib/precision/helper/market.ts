import entry from "@/lib/system/trading/entry";

import type {
  RuntimeEngineAdapter,
  RuntimeEngineState,
  RuntimeVPointMemory,
} from "../types";
import {
  DEFAULT_RECENT_VPOINTS,
  LIVE_FEED_KLINES_MISS_GRACE_MS,
  LIVE_FEED_MISS_GRACE_MS,
  LIVE_FEED_MISS_REPEAT_MS,
  MARK_PRICE_LOOKBACK_MINUTES,
  VPOINT_INITIAL_LOOKBACK_MINUTES,
} from "../constant";
import vpoints from "@/lib/system/utils/vpoints";
import runtimeErrors from "../utils/errors";
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
    entry.getSymbols(state.config, state.openPositions);
  const marketType =
    state.config.management.tradingMode === "futures" ? "FUTURES" : "SPOT";
  /**
   * Records sustained live-feed misses: the first seconds of an outage are
   * expected (socket warm-up), so only misses outliving the grace window
   * reach the error log. Every successful read resets the key's outage.
   */
  const liveFeedMiss = runtimeErrors.trackMisses({
    graceMs: LIVE_FEED_MISS_GRACE_MS,
    repeatMs: LIVE_FEED_MISS_REPEAT_MS,
    source: "runtime.market.live-feed",
  });
  // Closed candles need a wider window than mark prices: the first x:true
  // lands up to one full interval after the socket opens, so a healthy
  // feed can legitimately miss closedKlines for minutes after boot.
  const liveKlinesMiss = runtimeErrors.trackMisses({
    graceMs: LIVE_FEED_KLINES_MISS_GRACE_MS,
    repeatMs: LIVE_FEED_MISS_REPEAT_MS,
    source: "runtime.market.live-feed",
  });

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

      const symbols = getSymbols();
      // PROD:MARKET_LIVE_FEED — production streams candles over websocket;
      // backtests and cold/stale feeds keep answering through REST klines.
      adapter.market.live?.track(symbols, interval);

      const entries: Array<
        readonly [string, { lastUpdated: number; price: number }]
      > = [];

      for (const symbol of symbols) {
        // Live path: the websocket feed answers with the forming candle's
        // real-time close. Only reached when the feed is wired (production).
        const live = adapter.market.live?.markPrice(symbol, interval);
        
        // console.log(live ? "Use websocket mark price " : "REST fallback mark price")

        if (live) {
          liveFeedMiss.ok(`${symbol}:${interval}`);
          entries.push([symbol, live]);
          continue;
        }

        // PROD:MARKET_LIVE_FEED — the feed is wired (production) but cannot
        // serve this symbol; a sustained miss means a stale/dead stream and
        // is recorded so the outage stays visible instead of silently
        // riding REST. Backtests never reach this — they carry no `live`.
        if (adapter.market.live) {
          liveFeedMiss.miss(`${symbol}:${interval}`, (outageMs) =>
            new Error(
              `Live feed missed ${symbol}@${interval} mark price for ` +
              `${Math.round(outageMs / 1000)}s; REST fallback in use.`,
            ),
          );
        }

        // REST fallback: required for backtests (no feed), the first cycles
        // before the socket streams, newly added symbols, and any symbol
        // whose stream went stale — without it the stage would fail.
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

      const symbols = getSymbols();
      adapter.market.live?.track(symbols, interval);

      const intervalCursors = (volatilityCursors[interval] ??= {});

      for (const symbol of symbols) {
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


        // PROD:MARKET_LIVE_FEED — closed candles stream in over websocket;
        // when the buffer cannot reach back to `startTime` (cold start,
        // long gap) REST backfills the missing window once. `undefined`
        // conflates that designed backfill with a dead stream — they
        // separate by duration: a backfill misses a single pass, then the
        // buffer serves and clears the tracker; a dead feed misses every
        // pass until it outlives the wider kline grace and gets logged.
        const klinesKey = `${symbol}:${interval}:klines`;
        const buffered = adapter.market.live?.closedKlines(
          symbol,
          interval,
          startTime,
        );
        if (adapter.market.live) {
          if (buffered === undefined) {
            liveKlinesMiss.miss(klinesKey, (outageMs) =>
              new Error(
                `Live feed missed ${symbol}@${interval} closed klines for ` +
                `${Math.round(outageMs / 1000)}s; REST backfill in use.`,
              ),
            );
          } else {
            liveKlinesMiss.ok(klinesKey);
          }
        }

        // console.log(buffered ? "Using websocket Vpoints" : "REST fallback Vpoints")

        const klines =
          buffered ??
          (await adapter.market.getKlines({
            endTime: currentTime,
            exactDate: true,
            interval,
            marketType,
            startTime,
            symbol: `${symbol}_USDT`,
          }));
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
