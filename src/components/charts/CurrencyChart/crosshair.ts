import type { Dispatch, SetStateAction } from "react";
import type { ISeriesApi } from "lightweight-charts";
import type { Marker } from "@/lib/system/utils/ui/chart-markers";
import type {
    MarkerHoverState,
    TrajectoryDirection,
    TrajectoryHoverState,
    TrajectoryMetaPoint,
} from "./types";
import { computeTrajectoryPnl } from "./trajectory";

export function createCrosshairHandler({
    chartContainerRef,
    seriesRef,
    trajectoryMetaRef,
    markerMetaRef,
    trajectoryAnchorPriceRef,
    trajectoryDirectionRef,
    setTrajectoryHover,
    setMarkerHover,
}: {
    chartContainerRef: { current: HTMLDivElement | null };
    seriesRef: { current: ISeriesApi<any> | null };
    trajectoryMetaRef: {
        current: Map<ISeriesApi<"Line">, TrajectoryMetaPoint[]>;
    };
    markerMetaRef: { current: Marker[] };
    trajectoryAnchorPriceRef: { current: number | undefined };
    trajectoryDirectionRef: { current: TrajectoryDirection };
    setTrajectoryHover: Dispatch<
        SetStateAction<TrajectoryHoverState | null>
    >;
    setMarkerHover: Dispatch<SetStateAction<MarkerHoverState | null>>;
}) {
    return (param: any) => {
        const container = chartContainerRef.current;
        if (
            !container ||
            !param?.point ||
            typeof param.point.x !== "number" ||
            typeof param.point.y !== "number" ||
            param.point.x < 0 ||
            param.point.y < 0 ||
            param.point.x > container.clientWidth ||
            param.point.y > container.clientHeight
        ) {
            setTrajectoryHover(null);
            setMarkerHover(null);
            return;
        }

        for (const [series, points] of trajectoryMetaRef.current.entries()) {
            const dataAtPoint = param.seriesData?.get?.(series);
            if (!dataAtPoint) {
                continue;
            }

            const hoveredTime =
                typeof dataAtPoint.time === "number"
                    ? dataAtPoint.time
                    : typeof param.time === "number"
                        ? param.time
                        : null;
            const hoveredValue =
                typeof dataAtPoint.value === "number"
                    ? dataAtPoint.value
                    : typeof dataAtPoint.close === "number"
                        ? dataAtPoint.close
                        : null;

            const matchedPoint = points.find((item) =>
                item.normalizedTime === hoveredTime &&
                hoveredValue !== null &&
                Math.abs(item.point.price - hoveredValue) <= Math.max(item.point.price * 0.000001, 1e-10),
            );

            if (!matchedPoint) {
                continue;
            }

            setTrajectoryHover({
                x: Math.min(param.point.x + 12, Math.max(8, container.clientWidth - 320)),
                y: Math.max(8, param.point.y - 12),
                scenario: matchedPoint.scenario,
                pointIndex: matchedPoint.pointIndex,
                point: matchedPoint.point,
                pnlPercent: computeTrajectoryPnl({
                    entryPrice: trajectoryAnchorPriceRef.current,
                    pointPrice: matchedPoint.point.price,
                    direction: trajectoryDirectionRef.current,
                }),
            });
            setMarkerHover(null);
            return;
        }

        setTrajectoryHover(null);

        const candleSeries = seriesRef.current;
        const hoveredSeriesData = candleSeries
            ? param.seriesData?.get?.(candleSeries)
            : null;
        const hoveredTime =
            typeof hoveredSeriesData?.time === "number"
                ? hoveredSeriesData.time
                : typeof param.time === "number"
                    ? param.time
                    : null;

        if (!candleSeries || hoveredTime === null) {
            setMarkerHover(null);
            return;
        }

        const markerMatch = markerMetaRef.current
            .filter(
                (marker) =>
                    marker.time === hoveredTime &&
                    typeof marker.price === "number" &&
                    Number.isFinite(marker.price) &&
                    typeof marker.tooltipText === "string" &&
                    marker.tooltipText.length > 0,
            )
            .map((marker) => {
                const coordinate = candleSeries.priceToCoordinate(marker.price!);
                return {
                    marker,
                    coordinate,
                    distance:
                        typeof coordinate === "number"
                            ? Math.abs(coordinate - param.point.y)
                            : Number.POSITIVE_INFINITY,
                };
            })
            .filter((item) => Number.isFinite(item.distance))
            .sort((a, b) => a.distance - b.distance)[0];

        if (markerMatch && markerMatch.distance <= 18) {
            setMarkerHover({
                x: Math.min(param.point.x + 12, Math.max(8, container.clientWidth - 320)),
                y: Math.max(8, param.point.y - 12),
                title: markerMatch.marker.tooltipTitle ?? markerMatch.marker.text,
                text: markerMatch.marker.tooltipText ?? markerMatch.marker.text,
            });
            return;
        }

        setMarkerHover(null);
    };
}
