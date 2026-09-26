"use client";

import { useMemo } from "react";

import { makeSeries } from "@/components/LiveDashboard/utils";
import MultiLineTimelined from "@/components/ui/Chart/MultiLineTimelined";
import type { VolatilityPoint } from "@/lib/system/types";
import { Box, Typography } from "@mui/material";

export default function VolatilityPointsPanel({
    title,
    volatilityMap,
}: {
    title: string;
    volatilityMap: Record<string, VolatilityPoint[]>;
}) {
    const chartData = useMemo(() => {
        const names = Object.keys(volatilityMap).sort();
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
            <Typography variant="h6" sx={{ mb: 1 }}>
                {title}
            </Typography>
            {chartData.totalPoints > 0 ? (
                <MultiLineTimelined
                    names={chartData.names}
                    series={chartData.series}
                    height={420}
                />
            ) : (
                <Typography color="text.secondary" variant="body2" sx={{ py: 2 }}>
                    No volatility points were captured.
                </Typography>
            )}
        </Box>
    );
}
