/**
 * Indicator market feed — the feature pipeline's kline I/O for every
 * configured indicator instance. One base-candle read per symbol per tick
 * (1m when any instance needs it, else 5m) is aggregated into each
 * instance's interval and folded into its running state at
 * `state.features.acc[paramsKey][symbol]`.
 *
 * Environment-neutral: reads through `context.adapter.market` — the live
 * feed's closed-kline buffer when wired (production/sandbox), REST/dataset
 * backfill otherwise (backtest). Never imports an environment adapter.
 */
import type { RuntimeContext } from "@/lib/precision/types";

import indicatorCandles from "./candles";
import indicatorConfig from "../config";
import { INDICATOR_INTERVAL_MS } from "../constants";
import indicatorRegistry from "../registry";
import type { FeatureIndicatorConfig, IndicatorAccumulator } from "../types";

interface DueInstance {
  acc: IndicatorAccumulator;
  cfg: FeatureIndicatorConfig;
  fromMs: number;
  intervalMs: number;
}

/**
 * Folds every newly closed candle into each enabled instance. Symbols
 * follow `vPointsMap` keys (configured coins, open-position coins, BTC
 * context). Instances sharing params share one running state, keyed by
 * params so renaming an id never re-warms. A state with no complete
 * candle pending is skipped without any read, so large intervals cost
 * nothing between their boundaries.
 */
async function update(context: RuntimeContext): Promise<void> {
  // BOTH:INDICATOR_FEATURES — same feed in backtest, sandbox, and live.
  const { adapter, state } = context;
  const now = state.currentTime;
  const instances = indicatorConfig.resolve(state.config.management.indicators);
  const store = (state.features ??= { coins: {}, shared: {} });

  const byKey = new Map<string, FeatureIndicatorConfig>();
  for (const cfg of instances) {
    const key = indicatorConfig.key(cfg);
    if (!byKey.has(key)) byKey.set(key, cfg);
  }
  // Keep only running state an enabled instance still reads.
  const accs: Record<string, Record<string, IndicatorAccumulator>> = {};
  for (const key of byKey.keys()) accs[key] = store.acc?.[key] ?? {};
  store.acc = accs;

  const symbols = Object.keys(state.vPointsMap);
  if (byKey.size === 0 || symbols.length === 0) return;

  const base = instances.some((cfg) => cfg.interval === "1m") ? "1m" : "5m";
  const baseMs = INDICATOR_INTERVAL_MS[base];
  adapter.market.live?.track(symbols, base);
  const marketType =
    state.config.management.tradingMode === "futures" ? "FUTURES" : "SPOT";

  for (const symbol of symbols) {
    const due: DueInstance[] = [];
    for (const [key, cfg] of byKey) {
      const definition = indicatorRegistry.of(cfg);
      let acc = accs[key][symbol];
      if (!acc || definition.state.stale(acc, cfg, now)) {
        acc = accs[key][symbol] = definition.state.create(cfg, now);
      }
      const intervalMs = INDICATOR_INTERVAL_MS[cfg.interval];
      const fromMs =
        acc.t > 0 ? acc.t + intervalMs : definition.state.warmupStartMs(cfg, now);
      // No candle of this interval can have closed since the cursor.
      if (fromMs + intervalMs > now) continue;
      due.push({ acc, cfg, fromMs, intervalMs });
    }
    if (due.length === 0) continue;

    const startTime = Math.min(...due.map((item) => item.fromMs));
    const klines = (
      adapter.market.live?.closedKlines(symbol, base, startTime) ??
      (await adapter.market.getKlines({
        endTime: now,
        exactDate: true,
        interval: base,
        marketType,
        startTime,
        symbol: `${symbol}_USDT`,
      }))
    ).filter((kline) => kline[6] <= now);

    for (const item of due) {
      const candles = indicatorCandles.aggregate(klines, {
        baseMs,
        fromMs: item.fromMs,
        intervalMs: item.intervalMs,
        nowMs: now,
      });
      const definition = indicatorRegistry.of(item.cfg);
      for (const candle of candles) {
        if (candle.t > item.acc.t) definition.state.fold(item.acc, candle, item.cfg);
      }
    }
  }
}

const indicatorFeed = { update } as const;

export default indicatorFeed;
