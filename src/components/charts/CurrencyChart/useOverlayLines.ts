"use client";

import { useEffect } from "react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import { LineSeries } from "lightweight-charts";
import { BandSeries, type BandPlotRow } from "./BandSeries";
import type { OverlayBand, OverlayLine } from "./types";

/**
 * Syncs indicator overlays with the `overlayLines`/`overlayBands` props:
 * translucent band fills first (beneath), then the line series. Rebuilds
 * the set whenever an array identity changes — callers should pass
 * memoized arrays so unrelated renders don't recreate series.
 */
export function useOverlayLines({
    chartRef,
    overlayBands,
    overlayLines,
    bandSeriesRef,
    overlaySeriesRef,
}: {
    chartRef: { current: IChartApi | null };
    overlayBands: OverlayBand[] | undefined;
    overlayLines: OverlayLine[] | undefined;
    bandSeriesRef: { current: ISeriesApi<"Custom">[] };
    overlaySeriesRef: { current: ISeriesApi<"Line">[] };
}) {
    useEffect(() => {
        const chart = chartRef.current;
        if (!chart) {
            return;
        }

        overlaySeriesRef.current.forEach((series) => {
            chart.removeSeries(series);
        });
        overlaySeriesRef.current = [];
        bandSeriesRef.current.forEach((series) => {
            chart.removeSeries(series);
        });
        bandSeriesRef.current = [];

        overlayBands?.forEach((band) => {
            const points = (band.data ?? [])
                .filter(
                    (point) =>
                        typeof point?.time === "number" &&
                        Number.isFinite(point.time) &&
                        Number.isFinite(point.upper) &&
                        Number.isFinite(point.lower),
                )
                .sort((a, b) => a.time - b.time);

            if (points.length < 2) {
                return;
            }

            const series = chart.addCustomSeries(new BandSeries(), {
                fillColor: band.color ?? "rgba(144, 164, 174, 0.18)",
                priceLineVisible: false,
                lastValueVisible: false,
                title: band.name ?? "",
            });

            series.setData(points as BandPlotRow[]);
            bandSeriesRef.current.push(series);
        });

        overlayLines?.forEach((line) => {
            const points = (line.data ?? [])
                .filter(
                    (point) =>
                        typeof point?.time === "number" &&
                        Number.isFinite(point.time) &&
                        Number.isFinite(point.value),
                )
                .sort((a, b) => a.time - b.time);

            if (points.length === 0) {
                return;
            }

            const series = chart.addSeries(LineSeries, {
                color: line.color ?? "#2962ff",
                lineWidth: (line.lineWidth ?? 2) as any,
                lineStyle: line.lineStyle ?? 0,
                priceLineVisible: false,
                lastValueVisible: false,
                crosshairMarkerVisible: false,
                title: line.name ?? "",
            });

            series.setData(points as any);
            overlaySeriesRef.current.push(series);
        });
    }, [chartRef, overlayBands, overlayLines, bandSeriesRef, overlaySeriesRef]);
}
