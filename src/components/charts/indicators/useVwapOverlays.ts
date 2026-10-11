"use client";

import { alpha } from "@mui/material/styles";
import { LineStyle } from "lightweight-charts";
import { useMemo } from "react";

import type {
  OverlayBand,
  OverlayLine,
} from "@/components/charts/CurrencyChart/types";
import chartIndicators, {
  type VwapIndicatorConfig,
} from "@/lib/system/utils/ui/chart-indicators";
import { INDICATOR_INTERVAL_MS } from "@/lib/features/indicators";
import vwap, {
  type VwapAnchor,
  type VwapCandle,
  type VwapSeries,
} from "@/lib/system/utils/ui/chart-vwap";

import type { SourceCandles } from "./useSourceCandles";

/**
 * Builds overlay lines and band fills for every visible VWAP instance.
 * The Entry anchor falls back to Session when the chart has no position.
 * Gate-mode instances fold their source interval's closed candles (as the
 * runtime does) and are resampled onto chart candle times; they draw
 * nothing until those candles load.
 */
export function useVwapOverlays({
  candles,
  sourceCandles,
  instances,
  entryAnchorMs,
  vPointTimes,
}: {
  candles: VwapCandle[];
  sourceCandles: SourceCandles;
  instances: VwapIndicatorConfig[];
  entryAnchorMs?: number;
  vPointTimes: number[];
}) {
  return useMemo(() => {
    const lines: OverlayLine[] = [];
    const bands: OverlayBand[] = [];
    if (candles.length === 0) return { bands, lines };
    const chartIntervalSec = vwap.intervalSec(candles);
    const times = candles.map((candle) => candle.time);

    for (const instance of instances) {
      if (!instance.visible) continue;

      const anchor: VwapAnchor =
        instance.anchor === "entry" && entryAnchorMs === undefined
          ? "session"
          : instance.anchor;
      let result: VwapSeries;
      const source = chartIndicators.vwap.source(instance);
      if (source) {
        const candlesAtSource = sourceCandles[source];
        if (!candlesAtSource) continue;
        result = vwap.resample(
          vwap.compute(candlesAtSource, { anchor, bands: instance.bands }),
          {
            times,
            chartIntervalSec,
            sourceIntervalSec: INDICATOR_INTERVAL_MS[source] / 1000,
          },
        );
      } else {
        result = vwap.compute(candles, {
          anchor,
          anchorTimeMs: anchor === "entry" ? entryAnchorMs : undefined,
          boundariesMs: vPointTimes,
          bands: instance.bands,
        });
      }
      const name = chartIndicators.vwap.label({
        anchor,
        bands: [],
        gate: instance.gate,
        src: instance.src,
      });

      lines.push({
        name,
        color: instance.color,
        lineWidth: 2,
        data: result.vwap,
      });

      // Outermost bands first: nested translucent fills stack darker
      // toward the VWAP line.
      for (let index = instance.bands.length - 1; index >= 0; index--) {
        const mult = instance.bands[index];
        if (instance.fill) {
          bands.push({
            name: `${name} ±${mult}σ`,
            color: alpha(instance.color, 0.07),
            data: result.upper[index].map((point, i) => ({
              time: point.time,
              upper: point.value,
              lower: result.lower[index][i]?.value,
            })),
          });
        }
        const rail = {
          color: alpha(instance.color, 0.55),
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
        };
        lines.push(
          { ...rail, name: `${name} +${mult}σ`, data: result.upper[index] },
          { ...rail, name: `${name} −${mult}σ`, data: result.lower[index] },
        );
      }
    }
    return { bands, lines };
  }, [candles, sourceCandles, instances, entryAnchorMs, vPointTimes]);
}
