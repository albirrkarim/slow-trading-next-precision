"use client";

import { useMemo } from "react";

import type { CandlePoint, OverlayBand, OverlayLine } from "@/components/charts/CurrencyChart/types";
import chartIndicators from "@/lib/system/utils/ui/chart-indicators";

import type { ChartIndicatorsApi } from "./useChartIndicators";
import { useEmaOverlays } from "./useEmaOverlays";
import { useSourceCandles, type SourceCandles } from "./useSourceCandles";
import { useSupertrendOverlays } from "./useSupertrendOverlays";
import { useVwapOverlays } from "./useVwapOverlays";

/**
 * Every chart indicator overlay for a candle set: VWAP lines + band fills,
 * Supertrend and EMA lines, plus the runtime-faithful source candles the
 * gate-mode instances fold. Shared by the trade chart dialogs and `/live`.
 */
export function useChartOverlays({
  indicators,
  candles,
  symbol,
  exchange,
  marketType,
  vPointTimes,
  entryAnchorMs,
}: {
  indicators: ChartIndicatorsApi;
  candles: CandlePoint[];
  symbol: string;
  exchange: string;
  marketType?: "SPOT" | "FUTURES";
  /** vPoint times (ms) — the "V-Points" VWAP anchor. */
  vPointTimes: number[];
  /** Position entry (ms) — the "Entry" VWAP anchor; absent falls back to Session. */
  entryAnchorMs?: number;
}): { overlayLines: OverlayLine[]; overlayBands: OverlayBand[]; sourceCandles: SourceCandles } {
  const source = useSourceCandles({
    requests:
      candles.length > 0
        ? chartIndicators.sourceRequests(indicators.config, candles[0].time * 1000)
        : [],
    symbol,
    exchange,
    marketType,
    endTime:
      candles.length > 1
        ? (candles[candles.length - 1].time * 2 - candles[candles.length - 2].time) * 1000
        : undefined,
  });
  const vwapOverlay = useVwapOverlays({
    candles,
    sourceCandles: source.candles,
    instances: indicators.config.vwaps,
    entryAnchorMs,
    vPointTimes,
  });
  const supertrendLines = useSupertrendOverlays({
    candles,
    sourceCandles: source.candles,
    instances: indicators.config.supertrends,
  });
  const emaLines = useEmaOverlays({
    candles,
    sourceCandles: source.candles,
    instances: indicators.config.emas,
  });
  const overlayLines = useMemo(
    () => [...vwapOverlay.lines, ...supertrendLines, ...emaLines],
    [emaLines, supertrendLines, vwapOverlay.lines],
  );
  return { overlayBands: vwapOverlay.bands, overlayLines, sourceCandles: source.candles };
}
