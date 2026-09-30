import type { ActivePosition, AimMarkerSource, TrajectoryPoint } from "./types";

export function countDecimals(value: number): number {
    if (!Number.isFinite(value)) return 0;
    const s = value.toString();
    const i = s.indexOf(".");
    return i >= 0 ? s.length - i - 1 : 0;
}

export function computePricePrecision(params: {
    data: Array<{ open: number; high: number; low: number; close: number }>;
    activePosition?: ActivePosition;
    aimPosition?: AimMarkerSource;
    trajectory?: TrajectoryPoint[][];
}): number {
    const { data, activePosition, aimPosition, trajectory } = params;

    let maxDecimals = 0;
    for (let i = Math.max(0, data.length - 200); i < data.length; i++) {
        const d = data[i];
        maxDecimals = Math.max(
            maxDecimals,
            countDecimals(d.open),
            countDecimals(d.high),
            countDecimals(d.low),
            countDecimals(d.close),
        );
    }

    const entryPrice = activePosition?.exposure.averageEntryPrice;
    if (typeof entryPrice === "number") {
        maxDecimals = Math.max(maxDecimals, countDecimals(entryPrice));
    }

    const beginPrice = aimPosition?.beginPrice;
    if (typeof beginPrice === "number") {
        maxDecimals = Math.max(maxDecimals, countDecimals(beginPrice));
    }

    trajectory?.flat().forEach((point) => {
        if (typeof point.price === "number") {
            maxDecimals = Math.max(maxDecimals, countDecimals(point.price));
        }
    });

    // reasonable clamp; many exchanges use up to 8 decimals
    return Math.min(Math.max(maxDecimals, 2), 8);
}
