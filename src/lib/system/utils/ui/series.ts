import { COLORS_BG } from "./colors";

import {
    convertVolatilityToLeveledMarkers,
    convertVolatilityToMarkers,
    type LeveledMarkers,
    type Marker,
} from "./chart-markers";
import type { VolatilityPoint } from "@/lib/system/types";

/** Builds per-symbol leveled series plus plain markers from a volatility-point map. */
export const makeSeries = (data: Record<string, VolatilityPoint[]>, COLORS = COLORS_BG) => {
    const series: LeveledMarkers[][] = [];
    const markers: Marker[][] = [];

    let idx = 0;
    for (const symbol of Object.keys(data)) {
        series.push(
            convertVolatilityToLeveledMarkers(
                symbol,
                data[symbol],
                COLORS[idx % COLORS.length]
            )
        );

        markers.push(convertVolatilityToMarkers(data[symbol]));

        idx++;
    }

    return { series, markers };
};

/** Clips each series to [start, end] and adds flat bumpers at the edges for a smooth window. */
export function applyTimeWindowClient(
    seriesArr: { time: number;[key: string]: any }[][],
    start: number,
    end: number,
    justCut = false
) {
    for (let i = 0; i < seriesArr.length; i++) {
        // 1️⃣ Filter points within the window
        const filtered = seriesArr[i].filter(
            (p) => p.time >= start && p.time <= end
        );

        // 2️⃣ If no data in range — leave it empty (no bumpers)
        if (filtered.length === 0) {
            seriesArr[i] = [];
            continue;
        }

        if (justCut) {
            seriesArr[i] = filtered;
            continue;
        }

        // 3️⃣ Clone first & last items for smooth start/end bumpers
        const firstBumper = { ...filtered[0], time: start };
        const lastBumper = { ...filtered[filtered.length - 1], time: end };

        // 4️⃣ Insert bumpers and keep sorted
        const withBumpers = [firstBumper, ...filtered, lastBumper].sort(
            (a, b) => a.time - b.time
        );

        // 5️⃣ Replace back into the array
        seriesArr[i] = withBumpers;
    }
}
