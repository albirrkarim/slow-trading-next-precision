/**
 * VWAP market feed — the feature pipeline's own kline I/O. Folds each newly
 * closed 5m kline into the `state.features.vwap` accumulator that
 * `features.update` derives `coins[s].vwap*` from. Lives in the feature
 * module (not the engine's market helper) because it is feature-scoped
 * input: the engine's market stage knows mark prices and volatility
 * points; every other feed belongs to the feature that consumes it.
 *
 * Environment-neutral: reads through `context.adapter.market` — the live
 * feed's closed-kline buffer when wired (production/sandbox), REST
 * backfill only when the buffer cannot cover the window or no feed
 * exists (backtest). Never imports an environment adapter.
 */
import type { RuntimeContext } from "@/lib/precision/types";

import vwap from "./vwap";

/** VWAP is pinned to 5m candles even on 1m speedup passes — keeps σ granularity consistent. */
const VWAP_INTERVAL = "5m" as const;
const VWAP_INTERVAL_MS = 5 * 60_000;

/**
 * Folds each newly closed 5m kline into `state.features.vwap`. Symbols
 * follow `vPointsMap` keys — the exact set `features.update` derives coin
 * features for (configured coins, open-position coins, BTC context).
 *
 * The accumulator is self-deduping: `acc.t` is the open time of the last
 * folded candle, so a second call on the same tick folds nothing and a
 * month rollover (`acc.aT !== monthStart`) restarts the sums.
 */
async function update(context: RuntimeContext): Promise<void> {
  const { adapter, state } = context;
  const currentTime = state.currentTime;
  const symbols = Object.keys(state.vPointsMap);
  if (symbols.length === 0) return;

  adapter.market.live?.track(symbols, VWAP_INTERVAL);
  const store = (state.features ??= {
    coins: {},
    shared: {},
    vwap: {},
  });
  const accs = (store.vwap ??= {});
  const anchorMs = vwap.monthStartMs(currentTime);
  const marketType =
    state.config.management.tradingMode === "futures" ? "FUTURES" : "SPOT";

  for (const symbol of symbols) {
    let acc = accs[symbol];
    // Month rollover or first sight of the symbol — restart the sums.
    if (!acc || acc.aT !== anchorMs) {
      acc = accs[symbol] = vwap.accumulator.create(anchorMs);
    }
    const startTime = acc.t > 0 ? acc.t + VWAP_INTERVAL_MS : anchorMs;
    if (startTime >= currentTime) continue;

    const klines =
      adapter.market.live?.closedKlines(symbol, VWAP_INTERVAL, startTime) ??
      (await adapter.market.getKlines({
        endTime: currentTime,
        exactDate: true,
        interval: VWAP_INTERVAL,
        marketType,
        startTime,
        symbol: `${symbol}_USDT`,
      }));
    for (const kline of klines) {
      if (kline[6] <= currentTime && kline[0] > acc.t) {
        vwap.accumulator.foldKline(acc, kline);
      }
    }
  }
}

const vwapFeed = { update } as const;

export default vwapFeed;
