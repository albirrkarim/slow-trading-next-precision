"use client";

import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import { LineSeries } from "lightweight-charts";
import type {
    TrajectoryHoverState,
    TrajectoryMetaPoint,
    TrajectoryPoint,
} from "./types";
import { normalizeTrajectoryTime } from "./trajectory";

export function useTrajectorySeries({
    chartRef,
    trajectory,
    trajectoryAnchor,
    trajectorySeriesRef,
    trajectoryMetaRef,
    setTrajectoryHover,
}: {
    chartRef: { current: IChartApi | null };
    trajectory: TrajectoryPoint[][] | undefined;
    trajectoryAnchor: { price: number; time: number } | undefined;
    trajectorySeriesRef: { current: ISeriesApi<"Line">[] };
    trajectoryMetaRef: {
        current: Map<ISeriesApi<"Line">, TrajectoryMetaPoint[]>;
    };
    setTrajectoryHover: Dispatch<
        SetStateAction<TrajectoryHoverState | null>
    >;
}) {
    useEffect(() => {
        const chart = chartRef.current;
        if (!chart) {
            return undefined;
        }

        trajectorySeriesRef.current.forEach((series) => {
            chart.removeSeries(series);
        });
        trajectorySeriesRef.current = [];
        trajectoryMetaRef.current.clear();
        const resetHoverFrameId = window.requestAnimationFrame(() => {
            setTrajectoryHover(null);
        });

        const colors = ["#ff7043", "#42a5f5", "#66bb6a", "#ab47bc"];
        const scenarioNames = ["A", "B", "C", "D"];
        const anchorTime = trajectoryAnchor
            ? normalizeTrajectoryTime(trajectoryAnchor.time)
            : null;
        const anchor =
            anchorTime !== null &&
            typeof trajectoryAnchor?.price === "number" &&
            Number.isFinite(trajectoryAnchor.price) &&
            trajectoryAnchor.price > 0
                ? { time: anchorTime as any, value: trajectoryAnchor.price }
                : null;

        trajectory?.forEach((scenario, index) => {
            const scenarioPoints = scenario
                .map((point) => {
                    const time = normalizeTrajectoryTime(point.time);
                    if (
                        time === null ||
                        typeof point.price !== "number" ||
                        !Number.isFinite(point.price) ||
                        point.price <= 0
                    ) {
                        return null;
                    }

                    return {
                        time: time as any,
                        value: point.price,
                    };
                })
                .filter((point): point is { time: any; value: number } =>
                    Boolean(point),
                )
                .sort((a, b) => a.time - b.time);
            const points =
                anchor && (scenarioPoints[0]?.time ?? Number.POSITIVE_INFINITY) > anchor.time
                    ? [anchor, ...scenarioPoints]
                    : scenarioPoints;

            if (points.length === 0) {
                return;
            }

            const series = chart.addSeries(LineSeries, {
                color: colors[index % colors.length],
                lineWidth: 2,
                lineStyle: index === 2 ? 0 : 2,
                priceLineVisible: false,
                lastValueVisible: false,
                pointMarkersVisible: true,
                pointMarkersRadius: 4,
                crosshairMarkerVisible: true,
                title: `AIM ${String.fromCharCode(65 + index)}`,
            });

            series.setData(points);
            trajectorySeriesRef.current.push(series);
            trajectoryMetaRef.current.set(
                series,
                scenario
                    .map((point, pointIndex) => {
                        const normalizedTime = normalizeTrajectoryTime(point.time);
                        if (normalizedTime === null) {
                            return null;
                        }

                        return {
                            point,
                            pointIndex,
                            normalizedTime,
                            scenario: scenarioNames[index] ?? String.fromCharCode(65 + index),
                        };
                    })
                    .filter((item): item is TrajectoryMetaPoint => Boolean(item)),
            );
        });

        return () => {
            window.cancelAnimationFrame(resetHoverFrameId);
        };
    }, [chartRef, setTrajectoryHover, trajectory, trajectoryAnchor, trajectoryMetaRef, trajectorySeriesRef]);
}
