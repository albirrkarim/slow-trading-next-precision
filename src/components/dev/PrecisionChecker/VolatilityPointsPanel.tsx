"use client";

import { useMemo } from "react";

import { makeSeries } from "@/components/LiveDashboard/utils";
import MultiLineTimelined from "@/components/ui/Chart/MultiLineTimelined";
import HeaderMetrics from "@/components/ui/HeaderMetrics";
import type { VolatilityPoint } from "@/lib/system/types";
import { Box, Typography } from "@mui/material";

export default function VolatilityPointsPanel({
    title,
    volatilityMap,
    referenceLines,
}: {
    title: string;
    volatilityMap: Record<string, VolatilityPoint[]>;
    referenceLines?: { timeMs: number; label?: string; color?: string }[];
}) {
    const chartData = useMemo(() => {
        const names = Object.keys(volatilityMap)
            .filter((symbol) => symbol.split("_")[0] !== "BTC")
            .sort();
        const orderedMap = Object.fromEntries(
            names.map((symbol) => [symbol, volatilityMap[symbol]]),
        );
        const { series } = makeSeries(orderedMap);
        return {
            names,
            series,
            totalPoints: series.reduce((total, points) => total + points.length, 0),
        };
    }, [volatilityMap]);

    return (
        <Box component="section" aria-label={title} sx={{ minWidth: 0 }}>
            <HeaderMetrics
                defaultExpanded
                headerCanBeClicked
                rememberExpand={`precision-checker:${title}`}
                title={<Typography variant="body1" fontWeight={600}>{title}</Typography>}
            >
                {(expanded) =>
                    expanded &&
                    (chartData.totalPoints > 0 ? (
                        <MultiLineTimelined
                            names={chartData.names}
                            series={chartData.series}
                            height={420}
                            referenceLines={referenceLines}
                        />
                    ) : (
                        <Typography color="text.secondary" variant="body2" sx={{ py: 2 }}>
                            No volatility points were captured.
                        </Typography>
                    ))
                }
            </HeaderMetrics>
        </Box>
    );
}
