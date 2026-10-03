"use client";

import { useEffect, useRef } from "react";
import type { ISeriesApi } from "lightweight-charts";
import { LineStyle } from "lightweight-charts";
import type {
    ActivePosition,
    AimMarkerSource,
    OpenOrder,
} from "./types";

export function usePriceLines({
    seriesRef,
    activePosition,
    chartEntryLineColor,
    dashedEntryPriceLine,
    resolvedAimPosition,
    tpPrice,
    slPrice,
}: {
    seriesRef: { current: ISeriesApi<any> | null };
    activePosition: ActivePosition | undefined;
    chartEntryLineColor: string;
    dashedEntryPriceLine: boolean;
    resolvedAimPosition: AimMarkerSource;
    tpPrice: number | undefined;
    slPrice: number | undefined;
}) {
    // Handle Active Position Entry Line
    const entryLineRef = useRef<any>(null);
    const aimLineRef = useRef<any>(null);
    const tpLineRef = useRef<any>(null);
    const slLineRef = useRef<any>(null);

    useEffect(() => {
        if (!seriesRef.current) return;

        // Remove existing line
        if (entryLineRef.current) {
            seriesRef.current.removePriceLine(entryLineRef.current);
            entryLineRef.current = null;
        }

        // console.log("activePosition", activePosition)

        if (activePosition?.exposure.averageEntryPrice) {
            const hasAveragingExecutions =
                (activePosition.strategy.averaging.executions?.length ?? 0) > 0;

            entryLineRef.current = seriesRef.current.createPriceLine({
                price: activePosition.exposure.averageEntryPrice,
                color: chartEntryLineColor,
                lineWidth: 2,
                // BTEST:BACKTEST_TRADE_CHART_AVERAGING
                lineStyle: dashedEntryPriceLine
                    ? LineStyle.Dashed
                    : LineStyle.Dotted,
                axisLabelVisible: true,
                title: hasAveragingExecutions ? 'Avg Entry' : 'Entry',
            });
        }

    }, [activePosition, chartEntryLineColor, dashedEntryPriceLine, seriesRef]);

    useEffect(() => {
        if (!seriesRef.current) return;

        if (aimLineRef.current) {
            seriesRef.current.removePriceLine(aimLineRef.current);
            aimLineRef.current = null;
        }

        if (resolvedAimPosition && typeof resolvedAimPosition.beginPrice === "number") {
            aimLineRef.current = seriesRef.current.createPriceLine({
                price: resolvedAimPosition.beginPrice,
                color: "#f9a825",
                lineWidth: 2,
                lineStyle: 1,
                axisLabelVisible: true,
                title: "AIM",
            });
        }
    }, [resolvedAimPosition, seriesRef]);

    useEffect(() => {
        if (!seriesRef.current) return;

        if (tpLineRef.current) {
            seriesRef.current.removePriceLine(tpLineRef.current);
            tpLineRef.current = null;
        }

        if (typeof tpPrice === "number" && Number.isFinite(tpPrice) && tpPrice > 0) {
            tpLineRef.current = seriesRef.current.createPriceLine({
                price: tpPrice,
                color: "#2e7d32",
                lineWidth: 2,
                lineStyle: 2,
                axisLabelVisible: true,
                title: "TP",
            });
        }
    }, [seriesRef, tpPrice]);

    useEffect(() => {
        if (!seriesRef.current) return;

        if (slLineRef.current) {
            seriesRef.current.removePriceLine(slLineRef.current);
            slLineRef.current = null;
        }

        if (typeof slPrice === "number" && Number.isFinite(slPrice) && slPrice > 0) {
            slLineRef.current = seriesRef.current.createPriceLine({
                price: slPrice,
                color: "#d32f2f",
                lineWidth: 2,
                lineStyle: 2,
                axisLabelVisible: true,
                title: "SL",
            });
        }
    }, [seriesRef, slPrice]);
}

export function useEntryOrderLines({
    seriesRef,
    entryOrders,
}: {
    seriesRef: { current: ISeriesApi<any> | null };
    entryOrders: OpenOrder[];
}) {
    const entryOrderLinesRef = useRef<any[]>([]);

    useEffect(() => {
        const series = seriesRef.current;
        if (!series) return;

        // Cleanup existing lines
        entryOrderLinesRef.current.forEach((line) => {
            series.removePriceLine(line);
        });
        entryOrderLinesRef.current = [];

        entryOrders.forEach((order) => {
            if (typeof order.targetPrice === "number" && Number.isFinite(order.targetPrice) && order.targetPrice > 0) {
                const line = series.createPriceLine({
                    price: order.targetPrice,
                    color: '#2962FF',
                    lineWidth: 2,
                    lineStyle: 1, // Dotted
                    axisLabelVisible: true,
                    title: `${(order.side ?? "ORDER").toUpperCase()} MAKER ${order.targetPrice}`,
                });
                entryOrderLinesRef.current.push(line);
            }
        });
    }, [entryOrders, seriesRef]);
}
