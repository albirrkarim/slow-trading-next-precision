import type { IndicatorDefinition } from "../types";
import vwapMath from "./math";
import type { CoinVwap, VwapAccumulator, VwapFeatureConfig } from "./types";

/** Registry definition: config fields, running state, reading, metrics. */
const definition: IndicatorDefinition<VwapFeatureConfig, VwapAccumulator, CoinVwap> = {
  type: "vwap",
  label: "VWAP (anchored)",
  idPrefix: "vwap",
  fields: [
    { key: "anchor", label: "Anchor", kind: "select", options: ["session", "week", "month"] },
  ],
  defaults: { interval: "5m", anchor: "month" },
  key: (cfg) => `vwap:${cfg.interval}:${cfg.anchor}`,
  summary: (cfg) => `VWAP ${cfg.interval} · ${cfg.anchor}`,
  state: {
    create: (cfg, nowMs) => vwapMath.accumulator.create(vwapMath.anchorStartMs(nowMs, cfg.anchor)),
    warmupStartMs: (cfg, nowMs) => vwapMath.anchorStartMs(nowMs, cfg.anchor),
    stale: (acc, cfg, nowMs) => acc.aT !== vwapMath.anchorStartMs(nowMs, cfg.anchor),
    fold(acc, candle, cfg) {
      // A candle from a later anchor period restarts the sums in place.
      const anchorT = vwapMath.anchorStartMs(candle.t, cfg.anchor);
      if (anchorT !== acc.aT) Object.assign(acc, vwapMath.accumulator.create(anchorT));
      vwapMath.accumulator.fold(acc, candle);
    },
  },
  derive: (acc, _cfg, ctx) => vwapMath.derive(acc, ctx.markPrice, ctx.signalPrice),
  // Mark-driven fields move every pass — VWAP never triggers a record alone.
  changeKey: () => undefined,
  metrics: {
    distancePct: { label: "distance pct", read: (value) => value?.distancePct },
    stretchPct: { label: "stretch pct", read: (value) => value?.stretchPct },
    dSigma: { label: "distance (σ)", read: (value) => value?.dSigma },
  },
};

export default definition;
