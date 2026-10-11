import { INDICATOR_INTERVAL_MS, MAX_INDICATOR_WARMUP_MS } from "../constants";
import type { IndicatorDefinition } from "../types";
import emaMath from "./math";
import type { CoinEma, EmaAccumulator, EmaFeatureConfig } from "./types";

/** Warm-up in candles — the seed's weight decays below 0.1% after ~3.5 lengths. */
const WARMUP_LENGTHS = 5;
const MIN_WARMUP_CANDLES = 200;

/** Registry definition: config fields, running state, reading, metrics. */
const definition: IndicatorDefinition<EmaFeatureConfig, EmaAccumulator, CoinEma> = {
  type: "ema",
  label: "EMA",
  idPrefix: "ema",
  fields: [
    { key: "length", label: "Length", kind: "integer", min: 1, max: 500 },
    { key: "source", label: "Source", kind: "select", options: ["close", "hl2", "hlc3"] },
  ],
  defaults: { interval: "1h", length: 50, source: "close" },
  key: (cfg) => `ema:${cfg.interval}:${cfg.length}:${cfg.source}`,
  summary: (cfg) => `EMA ${cfg.interval} · ${cfg.length} ${cfg.source}`,
  state: {
    create: () => emaMath.accumulator.create(),
    warmupStartMs(cfg, nowMs) {
      const intervalMs = INDICATOR_INTERVAL_MS[cfg.interval];
      const candles = Math.max(MIN_WARMUP_CANDLES, cfg.length * WARMUP_LENGTHS);
      const start = nowMs - Math.min(candles * intervalMs, MAX_INDICATOR_WARMUP_MS);
      return Math.ceil(start / intervalMs) * intervalMs;
    },
    // A gap longer than the warm-up window resumes worse than a reseed.
    stale: (acc, _cfg, nowMs) => acc.t > 0 && nowMs - acc.t > MAX_INDICATOR_WARMUP_MS,
    fold: (acc, candle, cfg) => emaMath.accumulator.fold(acc, candle, cfg),
  },
  derive: (acc, cfg, ctx) => emaMath.derive(acc, cfg, ctx.markPrice),
  // Value, distance, and slope move every candle — EMA never triggers a
  // record on its own.
  changeKey: () => undefined,
  metrics: {
    dPct: { label: "distance pct", read: (value) => value?.dPct },
    sPct: { label: "slope pct", read: (value) => value?.sPct },
  },
};

export default definition;
