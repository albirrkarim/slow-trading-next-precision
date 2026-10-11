"use client";

import { useMemo } from "react";

import type { OverlayLine } from "@/components/charts/CurrencyChart/types";
import indicators, { INDICATOR_INTERVAL_MS } from "@/lib/features/indicators";
import chartIndicators, { type EmaChartConfig } from "@/lib/system/utils/ui/chart-indicators";
import chartVwap, { type VwapCandle, type VwapPoint } from "@/lib/system/utils/ui/chart-vwap";

import type { SourceCandles } from "./useSourceCandles";

/** Folds candles with the runtime's EMA math; warm-up candles emit nothing. */
function points(candles: VwapCandle[], config: EmaChartConfig): VwapPoint[] {
  const params = { length: config.length, source: config.source };
  const acc = indicators.math.ema.accumulator.create();
  const out: VwapPoint[] = [];
  for (const candle of candles) {
    indicators.math.ema.accumulator.fold(acc, { ...candle, t: candle.time * 1000 }, params);
    if (indicators.math.ema.ready(acc, params)) out.push({ time: candle.time, value: acc.e });
  }
  return out;
}

/**
 * Overlay lines for every visible EMA instance — folded on the chart's
 * candles, or on `src` candles (with warm-up) resampled onto the chart
 * when the instance mirrors a runtime feature.
 */
export function useEmaOverlays({
  candles,
  sourceCandles,
  instances,
}: {
  candles: VwapCandle[];
  sourceCandles: SourceCandles;
  instances: EmaChartConfig[];
}): OverlayLine[] {
  return useMemo(() => {
    if (candles.length === 0) return [];
    const chartIntervalSec = chartVwap.intervalSec(candles);
    const times = candles.map((candle) => candle.time);
    const lines: OverlayLine[] = [];
    for (const instance of instances) {
      if (!instance.visible) continue;
      let data: VwapPoint[];
      if (instance.src) {
        const source = sourceCandles[instance.src];
        if (!source) continue;
        data = chartVwap.resample(
          { vwap: points(source, instance), upper: [], lower: [] },
          {
            times,
            chartIntervalSec,
            sourceIntervalSec: INDICATOR_INTERVAL_MS[instance.src] / 1000,
          },
        ).vwap;
      } else {
        data = points(candles, instance);
      }
      lines.push({
        name: chartIndicators.ema.label(instance),
        color: instance.color,
        lineWidth: 2,
        data,
      });
    }
    return lines;
  }, [candles, sourceCandles, instances]);
}
