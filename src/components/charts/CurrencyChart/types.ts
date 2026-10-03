import type { Marker } from "@/lib/system/utils/ui/chart-markers";
import type { Position } from "@/lib/system/trading";

export type TrajectoryPoint = {
    message?: string;
    price: number;
    scenario?: string;
    time: number;
    timeHuman?: string;
};

export type ActivePosition = Pick<
    Position<any>,
    "exposure" | "opened" | "strategy"
>;

export type OpenOrder = {
    price?: number;
    side?: string;
    targetPrice?: number;
    time?: number;
};

export type AimMarkerSource = {
    beginPrice?: number;
    beginTime?: number;
} | undefined;

export type CandlePoint = {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
};

export type CandleOrWhitespacePoint = CandlePoint | { time: number };

export type TrajectoryDirection = "LONG" | "SHORT" | undefined;

export type TrajectoryHoverState = {
    x: number;
    y: number;
    scenario: string;
    pointIndex: number;
    point: TrajectoryPoint;
    pnlPercent: number | null;
};

export type MarkerHoverState = {
    x: number;
    y: number;
    title: string;
    text: string;
};

export interface ChartProps {
    data: CandlePoint[];
    markers?: Marker[];
    activePosition?: ActivePosition;
    aimPosition?: AimMarkerSource;
    dashedEntryPriceLine?: boolean;
    tpPrice?: number;
    slPrice?: number;
    betterToCloseAt?: number;
    entryOrders: OpenOrder[];
    height?: number;
    /**
     * Time window (chart-time seconds) shown once when fresh data first
     * arrives, instead of fitting the whole fetched range.
     */
    initialVisibleRange?: { from: number; to: number };
    trajectory?: TrajectoryPoint[][];
    trajectoryAnchor?: {
        price: number;
        time: number;
    };
    trajectoryDirection?: TrajectoryDirection;
}
