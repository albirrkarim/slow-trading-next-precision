"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "@mui/material/styles";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import { createChart, ColorType, CandlestickSeries, createSeriesMarkers, HistogramSeries } from "lightweight-charts";
import type { Marker } from "@/lib/system/utils/ui/chart-markers";
import type {
    ChartProps,
    MarkerHoverState,
    TrajectoryDirection,
    TrajectoryHoverState,
    TrajectoryMetaPoint,
} from "./types";
import { activePositionToMarkers, aimPositionToMarkers } from "./markers";
import {
    BetterCloseOverlay,
    MarkerHoverTooltip,
    TrajectoryHoverTooltip,
} from "./overlays";
import { computePricePrecision } from "./precision";
import { createCrosshairHandler } from "./crosshair";
import {
    getMaxProjectedTime,
    padDataWithFutureWhitespace,
} from "./trajectory";
import { useBetterCloseLine } from "./useBetterCloseLine";
import { useEntryOrderLines, usePriceLines } from "./usePriceLines";
import { useTrajectorySeries } from "./useTrajectorySeries";
import { useOverlayLines } from "./useOverlayLines";

export default function CurrencyChart({ data, markers, activePosition, aimPosition, dashedEntryPriceLine = false, tpPrice, slPrice, betterToCloseAt, entryOrders, height = 400, trajectory, trajectoryAnchor, trajectoryDirection, initialVisibleRange, overlayLines, overlayBands }: ChartProps) {
    const theme = useTheme();
    const chartTextColor = theme.palette.text.secondary;
    const chartGridColor = theme.palette.divider;
    const chartEntryLineColor = theme.palette.text.primary;
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const seriesRef = useRef<ISeriesApi<any> | null>(null);
    const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
    const trajectorySeriesRef = useRef<ISeriesApi<"Line">[]>([]);
    const overlaySeriesRef = useRef<ISeriesApi<"Line">[]>([]);
    const bandSeriesRef = useRef<ISeriesApi<"Custom">[]>([]);
    const trajectoryMetaRef = useRef<Map<ISeriesApi<"Line">, TrajectoryMetaPoint[]>>(new Map());
    const trajectoryAnchorPriceRef = useRef<number | undefined>(trajectoryAnchor?.price);
    const trajectoryDirectionRef = useRef<TrajectoryDirection>(trajectoryDirection);
    const markersPrimitiveRef = useRef<any>(null);
    const resolvedAimPosition =
        aimPosition ?? activePosition?.strategy.entry.feature?.aimPosition;
    const [trajectoryHover, setTrajectoryHover] = useState<TrajectoryHoverState | null>(null);
    const [markerHover, setMarkerHover] = useState<MarkerHoverState | null>(null);
    const markerMetaRef = useRef<Marker[]>([]);
    const previousDataWindowRef = useRef<{ firstTime: number; lastTime: number } | null>(null);
    const previousProjectedTimeRef = useRef<number | null>(null);

    useEffect(() => {
        trajectoryAnchorPriceRef.current = trajectoryAnchor?.price;
        trajectoryDirectionRef.current = trajectoryDirection;
    }, [trajectoryAnchor?.price, trajectoryDirection]);

    useEffect(() => {
        if (!chartContainerRef.current) return;

        const chart = createChart(chartContainerRef.current, {
            layout: {
                background: { type: ColorType.Solid, color: "transparent" },
                textColor: chartTextColor,
            },
            width: chartContainerRef.current.clientWidth,
            height,
            grid: {
                vertLines: { color: chartGridColor },
                horzLines: { color: chartGridColor },
            },
            timeScale: {
                timeVisible: true,
                secondsVisible: true,
            },
        });

        const candlestickSeries = chart.addSeries(CandlestickSeries, {
            upColor: "#26a69a",
            downColor: "#ef5350",
            borderVisible: false,
            wickUpColor: "#26a69a",
            wickDownColor: "#ef5350"
        });

        markersPrimitiveRef.current = createSeriesMarkers(candlestickSeries, []);

        const volumeSeries = chart.addSeries(HistogramSeries, {
            color: "#26a69a",
            priceFormat: {
                type: "volume",
            },
            priceScaleId: "", // Set as an overlay
        });

        volumeSeries.priceScale().applyOptions({
            scaleMargins: {
                top: 0.8, // Highest volume bar will be 80% down the chart
                bottom: 0,
            },
        });

        chartRef.current = chart;
        seriesRef.current = candlestickSeries;
        volumeSeriesRef.current = volumeSeries;

        const handleCrosshairMove = createCrosshairHandler({
            chartContainerRef,
            seriesRef,
            trajectoryMetaRef,
            markerMetaRef,
            trajectoryAnchorPriceRef,
            trajectoryDirectionRef,
            setTrajectoryHover,
            setMarkerHover,
        });

        chart.subscribeCrosshairMove(handleCrosshairMove);

        const handleResize = () => {
            chart.applyOptions({
                width: chartContainerRef.current?.clientWidth || 0,
                height,
            });
        };

        window.addEventListener("resize", handleResize);

        // eslint-disable-next-line consistent-return
        return () => {
            window.removeEventListener("resize", handleResize);
            chart.unsubscribeCrosshairMove(handleCrosshairMove);
            chart.remove();
            seriesRef.current = null;
            volumeSeriesRef.current = null;
            markersPrimitiveRef.current = null;
        };
    }, [height]);

    // Keep chart colors in sync with the MUI theme without recreating it.
    useEffect(() => {
        chartRef.current?.applyOptions({
            layout: {
                background: { type: ColorType.Solid, color: "transparent" },
                textColor: chartTextColor,
            },
            grid: {
                vertLines: { color: chartGridColor },
                horzLines: { color: chartGridColor },
            },
        });
    }, [chartGridColor, chartTextColor]);

    // Update data
    useEffect(() => {
        if (seriesRef.current && volumeSeriesRef.current && data.length > 0) {
            // Sort and deduplicate data by time
            const uniqueDataMap = new Map();
            data.forEach((item) => uniqueDataMap.set(item.time, item));
            const sortedData = Array.from(uniqueDataMap.values()).sort(
                (a, b) => a.time - b.time
            );
            const firstTime = sortedData[0]?.time;
            const lastTime = sortedData[sortedData.length - 1]?.time;
            const previousDataWindow = previousDataWindowRef.current;
            const chart = chartRef.current;
            const shouldPreserveVisibleRange =
                Boolean(previousDataWindow) &&
                typeof firstTime === "number" &&
                typeof lastTime === "number" &&
                previousDataWindow?.firstTime === firstTime &&
                lastTime >= previousDataWindow.lastTime;
            const visibleLogicalRange = shouldPreserveVisibleRange
                ? chart?.timeScale().getVisibleLogicalRange() ?? null
                : null;
            const dataWindowChanged =
                !previousDataWindow ||
                previousDataWindow.firstTime !== firstTime ||
                previousDataWindow.lastTime !== lastTime;
            const maxProjectedTime = getMaxProjectedTime({
                markers,
                trajectory,
                trajectoryAnchor,
                betterToCloseAt,
            });
            const projectedTimeChanged = previousProjectedTimeRef.current !== maxProjectedTime;
            const paddedData = padDataWithFutureWhitespace({
                data: sortedData as any,
                targetTime: maxProjectedTime,
            });

            const precision = computePricePrecision({
                data: sortedData as any,
                activePosition,
                aimPosition: resolvedAimPosition,
                trajectory,
            });
            const minMove = 1 / Math.pow(10, precision);
            seriesRef.current.applyOptions({
                priceFormat: {
                    type: "price",
                    precision,
                    minMove,
                },
            });

            seriesRef.current.setData(paddedData as any);

            const volumeData = paddedData.map((d: any) =>
                typeof d.volume === "number" && Number.isFinite(d.volume)
                    ? {
                        time: d.time,
                        value: d.volume,
                        color: d.close >= d.open ? "#26a69a" : "#ef5350",
                    }
                    : { time: d.time },
            );
            volumeSeriesRef.current.setData(volumeData as any);

            if (visibleLogicalRange && chart) {
                chart.timeScale().setVisibleLogicalRange(visibleLogicalRange);
            } else if (chart && initialVisibleRange && dataWindowChanged) {
                chart.timeScale().setVisibleRange({
                    from: initialVisibleRange.from as any,
                    to: initialVisibleRange.to as any,
                });
            } else if (chart && projectedTimeChanged) {
                chart.timeScale().fitContent();
            }

            if (typeof firstTime === "number" && typeof lastTime === "number") {
                previousDataWindowRef.current = { firstTime, lastTime };
            }
            previousProjectedTimeRef.current = maxProjectedTime;

            // Update markers (lightweight-charts v5 uses a markers primitive)
            if (markersPrimitiveRef.current?.setMarkers) {
                const m = Array.isArray(markers) ? [...markers] : [];

                if (activePosition) {
                    // Add active position marker (entry)
                    m.push(...activePositionToMarkers(activePosition));
                }

                if (resolvedAimPosition) {
                    m.push(...aimPositionToMarkers(resolvedAimPosition));
                }

                m.sort((a, b) => a.time - b.time);
                markerMetaRef.current = m;
                markersPrimitiveRef.current.setMarkers(m);
            }

            // Remove existing pricelines if any (not directly supported by API to "clear", so we rely on finding unique ones or recreation)
            // A better way is to store references to pricelines, but lightweight-charts React wrappers are complex.
            // For raw usage, we might need to remove them manually if the method exists, or just keep it simple.
            // Actually, `createPriceLine` returns an object with `applyOptions` and `remove`.

            // NOTE: Since we are re-using the chart series, we should probably clear pricelines.
            // However, lightweight-charts doesn't have a clearPriceLines method on the series.
            // We would need to track them. Ideally we would rebuild chart on position change or track strictly.
            // For now, let's proceed with adding it. If multiple lines heap up, we might need a ref to existingLine.
        }
    }, [activePosition, betterToCloseAt, data, initialVisibleRange, markers, resolvedAimPosition, trajectory, trajectoryAnchor]);

    const betterCloseLineX = useBetterCloseLine({
        chartRef,
        chartContainerRef,
        betterToCloseAt,
        data,
        height,
        markers,
        trajectory,
        trajectoryAnchor,
    });

    useTrajectorySeries({
        chartRef,
        trajectory,
        trajectoryAnchor,
        trajectorySeriesRef,
        trajectoryMetaRef,
        setTrajectoryHover,
    });

    usePriceLines({
        seriesRef,
        activePosition,
        chartEntryLineColor,
        dashedEntryPriceLine,
        resolvedAimPosition,
        tpPrice,
        slPrice,
    });

    useEntryOrderLines({
        seriesRef,
        entryOrders,
    });

    useOverlayLines({
        chartRef,
        overlayBands,
        overlayLines,
        bandSeriesRef,
        overlaySeriesRef,
    });

    const betterCloseLabel =
        typeof betterToCloseAt === "number" && Number.isFinite(betterToCloseAt) && betterToCloseAt > 0
            ? new Date(betterToCloseAt).toLocaleString()
            : null;

    return (
        <div ref={chartContainerRef} style={{ position: "relative" }}>
            <BetterCloseOverlay label={betterCloseLabel} lineX={betterCloseLineX} />
            {trajectoryHover ? (
                <TrajectoryHoverTooltip hover={trajectoryHover} />
            ) : null}
            {!trajectoryHover && markerHover ? (
                <MarkerHoverTooltip hover={markerHover} />
            ) : null}
        </div>
    );
}
