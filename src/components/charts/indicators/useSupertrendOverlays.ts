"use client";

import { useMemo } from "react";

import type { OverlayLine, OverlayLinePoint } from "@/components/charts/CurrencyChart/types";
import indicators, { INDICATOR_INTERVAL_MS } from "@/lib/features/indicators";
import chartIndicators, {
  type SupertrendChartConfig,
} from "@/lib/system/utils/ui/chart-indicators";
import vwap, { type VwapCandle } from "@/lib/system/utils/ui/chart-vwap";

import type { SourceCandles } from "./useSourceCandles";

const UP_COLOR = "#26a69a";
const DOWN_COLOR = "#ef5350";

/** Supertrend state after each candle: open time (s), line, direction. */
type SupertrendStep = { time: number; value: number; d: 1 | -1 };

/** Folds candles with the runtime's Supertrend math; warm-up candles emit nothing. */
function steps(candles: VwapCandle[], config: SupertrendChartConfig): SupertrendStep[] {
  const params = { atrLength: config.atrLength, factor: config.factor };
  const acc = indicators.math.supertrend.accumulator.create();
  const out: SupertrendStep[] = [];
  for (const candle of candles) {
    indicators.math.supertrend.accumulator.fold(acc, { ...candle, t: candle.time * 1000 }, params);
    if (indicators.math.supertrend.ready(acc, params)) {
      out.push({ time: candle.time, value: indicators.math.supertrend.line(acc), d: acc.d });
    }
  }
  return out;
}

/**
 * Maps source steps onto chart candle times: each chart candle takes the
 * latest step whose source candle had closed by the chart candle's close.
 */
function resampleSteps(
  source: SupertrendStep[],
  times: number[],
  chartIntervalSec: number,
  sourceIntervalSec: number,
): SupertrendStep[] {
  const out: SupertrendStep[] = [];
  let index = -1;
  for (const time of times) {
    while (
      index + 1 < source.length &&
      source[index + 1].time + sourceIntervalSec <= time + chartIntervalSec
    ) {
      index += 1;
    }
    if (index >= 0) out.push({ ...source[index], time });
  }
  return out;
}

const HIDDEN = "rgba(0, 0, 0, 0)";

/**
 * One line colored per point: green in an uptrend, red in a downtrend.
 * Segments take their starting point's color, so the point right before a
 * flip is transparent — the jump between bands is not drawn.
 */
function toLine(name: string, series: SupertrendStep[]): OverlayLine {
  const data: OverlayLinePoint[] = series.map((step, index) => ({
    time: step.time,
    value: step.value,
    color:
      series[index + 1] && series[index + 1].d !== step.d
        ? HIDDEN
        : step.d === 1
          ? UP_COLOR
          : DOWN_COLOR,
  }));
  return { name, color: UP_COLOR, lineWidth: 2, data };
}

/**
 * Overlay lines for every visible Supertrend instance — folded on the
 * chart's candles, or on `src` candles (with warm-up) resampled onto the
 * chart when the instance mirrors a runtime feature.
 */
export function useSupertrendOverlays({
  candles,
  sourceCandles,
  instances,
}: {
  candles: VwapCandle[];
  sourceCandles: SourceCandles;
  instances: SupertrendChartConfig[];
}): OverlayLine[] {
  return useMemo(() => {
    if (candles.length === 0) return [];
    const chartIntervalSec = vwap.intervalSec(candles);
    const times = candles.map((candle) => candle.time);
    const lines: OverlayLine[] = [];
    for (const instance of instances) {
      if (!instance.visible) continue;
      let series: SupertrendStep[];
      if (instance.src) {
        const source = sourceCandles[instance.src];
        if (!source) continue;
        series = resampleSteps(
          steps(source, instance),
          times,
          chartIntervalSec,
          INDICATOR_INTERVAL_MS[instance.src] / 1000,
        );
      } else {
        series = steps(candles, instance);
      }
      lines.push(toLine(chartIndicators.supertrend.label(instance), series));
    }
    return lines;
  }, [candles, sourceCandles, instances]);
}
