import type { Marker } from "@/lib/system/utils/ui/chart-markers";
import type { Position } from "@/lib/system/trading";
import type { TradePlan, TradePlanPoint } from "@/lib/system/utils/ui/trade-plan";

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

export type OverlayLinePoint = {
    time: number;
    value: number;
    /**
     * Per-point color. lightweight-charts colors each segment by its
     * starting point, so a transparent point hides the segment after it
     * (e.g. the jump at a Supertrend flip).
     */
    color?: string;
};

/** Indicator-style line drawn over the candles (e.g. VWAP, bands). */
export type OverlayLine = {
    name?: string;
    color?: string;
    lineWidth?: number;
    /** lightweight-charts LineStyle enum value. */
    lineStyle?: number;
    data: OverlayLinePoint[];
};

export type OverlayBandPoint = {
    time: number;
    upper: number;
    lower: number;
};

/** Translucent fill between an upper/lower price rail (band envelope). */
export type OverlayBand = {
    name?: string;
    /** Fill color — translucent rgba recommended; nested bands stack. */
    color?: string;
    data: OverlayBandPoint[];
};

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

export type TrajectoryMetaPoint = {
    point: TrajectoryPoint;
    scenario: string;
    pointIndex: number;
    normalizedTime: number;
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
    /**
     * Indicator overlays (VWAP, bands, …) rendered as line series on the
     * candle pane. Caller owns the computation; pass a stable array
     * reference (memoized) — the chart rebuilds the series on change.
     */
    overlayLines?: OverlayLine[];
    /**
     * Translucent fills between two price rails (band envelopes), drawn
     * beneath `overlayLines`. Same memoized-reference contract applies.
     */
    overlayBands?: OverlayBand[];
    /**
     * Fired (repeatedly) while the viewport sits within a few bars of the
     * oldest loaded candle — the owner prepends older history, and the
     * chart keeps the viewport on the same candles.
     */
    onNearLeftEdge?: () => void;
    /** Live mode: a viewport parked on the newest bar scrolls with new bars. */
    followLatest?: boolean;
    /**
     * Visual-only trade plans (entry, TP ladder, SL, entry time → timeout).
     * Drawn read-only; draggable once `onTradePlansChange` is given.
     */
    tradePlans?: TradePlan[];
    selectedTradePlanId?: string | null;
    /** Receives the whole plan list once a drag is released. */
    onTradePlansChange?: (plans: TradePlan[]) => void;
    /** Plan pressed on the chart, or null for a click on empty chart. */
    onSelectTradePlan?: (id: string | null) => void;
    /** Placement mode: the next click on empty chart goes to `onPlaceTradePlan`. */
    placingTradePlan?: boolean;
    /** Bar-snapped click point (ms, price) and the bar spacing, ms. */
    onPlaceTradePlan?: (point: TradePlanPoint, stepMs: number) => void;
}
