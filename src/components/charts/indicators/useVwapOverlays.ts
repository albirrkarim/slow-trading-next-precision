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
import vwapFeature from "@/lib/features/vwap";
import vwap, {
  type VwapAnchor,
  type VwapCandle,
  type VwapSeries,
} from "@/lib/system/utils/ui/vwap";

const GATE_INTERVAL_SEC = vwapFeature.INTERVAL_MS / 1000;

/**
 * Builds overlay lines and band fills for every visible VWAP instance.
 * The Entry anchor falls back to Session when the chart has no position.
 * "Match gate" instances fold `gateCandles` (the runtime's 5m klines) and
 * are resampled onto chart candle times; they draw nothing until loaded.
 */
export function useVwapOverlays({
  candles,
  gateCandles,
  instances,
  entryAnchorMs,
  vPointTimes,
}: {
  candles: VwapCandle[];
  gateCandles?: VwapCandle[];
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
      if (chartIndicators.vwap.matchesGate(instance)) {
        if (!gateCandles) continue;
        result = vwap.resample(
          vwap.compute(gateCandles, { anchor, bands: instance.bands }),
          { times, chartIntervalSec, sourceIntervalSec: GATE_INTERVAL_SEC },
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
  }, [candles, gateCandles, instances, entryAnchorMs, vPointTimes]);
}
