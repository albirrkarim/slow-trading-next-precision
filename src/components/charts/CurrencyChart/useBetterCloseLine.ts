"use client";

import { useEffect, useState } from "react";
import type { IChartApi } from "lightweight-charts";
import type { Marker } from "@/lib/system/utils/ui/chart-markers";
import type { CandlePoint, TrajectoryPoint } from "./types";
import { normalizeTrajectoryTime } from "./trajectory";

export function useBetterCloseLine({
    chartRef,
    chartContainerRef,
    betterToCloseAt,
    data,
    height,
    markers,
    trajectory,
    trajectoryAnchor,
}: {
    chartRef: { current: IChartApi | null };
    chartContainerRef: { current: HTMLDivElement | null };
    betterToCloseAt: number | undefined;
    data: CandlePoint[];
    height: number;
    markers: Marker[] | undefined;
    trajectory: TrajectoryPoint[][] | undefined;
    trajectoryAnchor: { price: number; time: number } | undefined;
}) {
    const [betterCloseLineX, setBetterCloseLineX] = useState<number | null>(null);

    useEffect(() => {
        const chart = chartRef.current;
        const container = chartContainerRef.current;
        const normalizedTime =
            typeof betterToCloseAt === "number"
                ? normalizeTrajectoryTime(betterToCloseAt)
                : null;
        let animationFrameId: number | null = null;

        if (!chart || !container || normalizedTime === null) {
            animationFrameId = window.requestAnimationFrame(() => {
                setBetterCloseLineX(null);
            });
            return () => {
                if (animationFrameId !== null) {
                    window.cancelAnimationFrame(animationFrameId);
                }
            };
        }

        const updateLinePosition = () => {
            const coordinate = chart.timeScale().timeToCoordinate(normalizedTime as any);
            setBetterCloseLineX(
                typeof coordinate === "number" &&
                    Number.isFinite(coordinate) &&
                    coordinate >= 0 &&
                    coordinate <= container.clientWidth
                    ? coordinate
                    : null,
            );
        };

        const handleResize = () => {
            window.requestAnimationFrame(updateLinePosition);
        };

        animationFrameId = window.requestAnimationFrame(updateLinePosition);
        chart.timeScale().subscribeVisibleLogicalRangeChange(updateLinePosition);
        window.addEventListener("resize", handleResize);

        return () => {
            if (animationFrameId !== null) {
                window.cancelAnimationFrame(animationFrameId);
            }
            chart.timeScale().unsubscribeVisibleLogicalRangeChange(updateLinePosition);
            window.removeEventListener("resize", handleResize);
        };
    }, [betterToCloseAt, chartContainerRef, chartRef, data, height, markers, trajectory, trajectoryAnchor]);

    return betterCloseLineX;
}
