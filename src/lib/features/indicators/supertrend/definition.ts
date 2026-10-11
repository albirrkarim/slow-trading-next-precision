import { INDICATOR_INTERVAL_MS, MAX_INDICATOR_WARMUP_MS } from "../constants";
import type { IndicatorDefinition } from "../types";
import supertrendMath from "./math";
import type {
  CoinSupertrend,
  SupertrendAccumulator,
  SupertrendFeatureConfig,
} from "./types";

/** Warm-up in candles — the RMA needs several lengths to converge. */
const WARMUP_LENGTHS = 20;
const MIN_WARMUP_CANDLES = 200;

/** Registry definition: config fields, running state, reading, metrics. */
const definition: IndicatorDefinition<
  SupertrendFeatureConfig,
  SupertrendAccumulator,
  CoinSupertrend
> = {
  type: "supertrend",
  label: "Supertrend",
  idPrefix: "st",
  fields: [
    { key: "atrLength", label: "ATR length", kind: "integer", min: 1, max: 500 },
    { key: "factor", label: "Factor", kind: "number", min: 0.1, max: 50 },
  ],
  defaults: { interval: "15m", atrLength: 10, factor: 3 },
  key: (cfg) => `st:${cfg.interval}:${cfg.atrLength}:${cfg.factor}`,
  summary: (cfg) => `Supertrend ${cfg.interval} · ${cfg.atrLength} × ${cfg.factor}`,
  state: {
    create: () => supertrendMath.accumulator.create(),
    warmupStartMs(cfg, nowMs) {
      const intervalMs = INDICATOR_INTERVAL_MS[cfg.interval];
      const candles = Math.max(MIN_WARMUP_CANDLES, cfg.atrLength * WARMUP_LENGTHS);
      const start = nowMs - Math.min(candles * intervalMs, MAX_INDICATOR_WARMUP_MS);
      return Math.ceil(start / intervalMs) * intervalMs;
    },
    // A gap longer than the warm-up window resumes worse than a reseed.
    stale: (acc, _cfg, nowMs) => acc.t > 0 && nowMs - acc.t > MAX_INDICATOR_WARMUP_MS,
    fold: (acc, candle, cfg) => supertrendMath.accumulator.fold(acc, candle, cfg),
  },
  derive: (acc, cfg, ctx) => supertrendMath.derive(acc, cfg, ctx.markPrice),
  // A flip (direction + flip candle) is the event worth recording.
  changeKey: (value) => (value ? `${value.d}:${value.fT ?? 0}` : undefined),
  metrics: {
    d: { label: "direction (1 up, −1 down)", read: (value) => value?.d },
    dPct: { label: "distance pct", read: (value) => value?.dPct },
    flipAgeMin: {
      label: "minutes since flip",
      read: (value, t) =>
        t === undefined || value?.fT === undefined ? undefined : (t - value.fT) / 60_000,
    },
  },
};

export default definition;
