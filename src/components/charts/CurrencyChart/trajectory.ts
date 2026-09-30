import type { Marker } from "@/lib/system/utils/ui/chart-markers";
import type {
    CandleOrWhitespacePoint,
    CandlePoint,
    TrajectoryDirection,
    TrajectoryPoint,
} from "./types";

export function normalizeTrajectoryTime(time: number): number | null {
    if (!Number.isFinite(time) || time <= 0) return null;

    // Decision times are unix ms, but chart coordinates are unix seconds.
    return Math.floor(time > 10_000_000_000 ? time / 1000 : time);
}

export function estimateBarStepSeconds(data: Array<{ time: number }>): number {
    if (data.length < 2) {
        return 60 * 5;
    }

    const diffs = data
        .slice(-50)
        .map((item, index, arr) => {
            if (index === 0) return null;
            const diff = item.time - arr[index - 1].time;
            return Number.isFinite(diff) && diff > 0 ? diff : null;
        })
        .filter((diff): diff is number => typeof diff === "number" && diff > 0)
        .sort((a, b) => a - b);

    if (diffs.length === 0) {
        return 60 * 5;
    }

    const middle = Math.floor(diffs.length / 2);
    return diffs.length % 2 === 0
        ? Math.max(1, Math.round((diffs[middle - 1] + diffs[middle]) / 2))
        : Math.max(1, Math.round(diffs[middle]));
}

export function getMaxProjectedTime(params: {
    markers?: Marker[];
    trajectory?: TrajectoryPoint[][];
    trajectoryAnchor?: { price: number; time: number };
    betterToCloseAt?: number;
}): number | null {
    const markerTimes = (params.markers ?? [])
        .map((marker) => Number(marker?.time))
        .filter((time) => Number.isFinite(time) && time > 0);
    const trajectoryTimes = (params.trajectory ?? [])
        .flat()
        .map((point) => normalizeTrajectoryTime(point.time))
        .filter((time): time is number => time !== null && time > 0);
    const anchorTime =
        typeof params.trajectoryAnchor?.time === "number"
            ? normalizeTrajectoryTime(params.trajectoryAnchor.time)
            : null;
    const betterCloseTime =
        typeof params.betterToCloseAt === "number"
            ? normalizeTrajectoryTime(params.betterToCloseAt)
            : null;
    const allTimes = [
        ...markerTimes,
        ...trajectoryTimes,
        ...(anchorTime !== null ? [anchorTime] : []),
        ...(betterCloseTime !== null ? [betterCloseTime] : []),
    ];

    return allTimes.length > 0 ? Math.max(...allTimes) : null;
}

export function padDataWithFutureWhitespace(params: {
    data: CandlePoint[];
    targetTime: number | null;
}): CandleOrWhitespacePoint[] {
    const { data, targetTime } = params;

    if (data.length === 0 || targetTime === null) {
        return data;
    }

    const lastTime = data[data.length - 1]?.time;
    if (!(Number.isFinite(lastTime) && targetTime > lastTime)) {
        return data;
    }

    const stepSeconds = estimateBarStepSeconds(data);
    const padded: CandleOrWhitespacePoint[] = [...data];

    for (let time = lastTime + stepSeconds; time <= targetTime; time += stepSeconds) {
        padded.push({ time });
    }

    return padded;
}

export function computeTrajectoryPnl(params: {
    entryPrice?: number;
    pointPrice: number;
    direction: TrajectoryDirection;
}): number | null {
    const { entryPrice, pointPrice, direction } = params;
    if (
        !(typeof entryPrice === "number" && Number.isFinite(entryPrice) && entryPrice > 0) ||
        !(typeof pointPrice === "number" && Number.isFinite(pointPrice) && pointPrice > 0)
    ) {
        return null;
    }

    const pnl =
        direction === "LONG"
            ? ((pointPrice - entryPrice) / entryPrice) * 100
            : ((entryPrice - pointPrice) / entryPrice) * 100;

    return Number.isFinite(pnl) ? pnl : null;
}
