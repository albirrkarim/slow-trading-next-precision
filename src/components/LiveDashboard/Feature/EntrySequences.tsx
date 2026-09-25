"use client";

import { DEFAULT_COLORS } from "@/components/client/constants";
import HeaderMetrics from "@/components/ui/HeaderMetrics";

import type { RuntimeEntrySequenceCount } from "@/lib/system/trading";
import { Box, Chip, Paper, Typography } from "@mui/material";
import { useMemo } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import EntrySequenceHoldDurationChart from "./EntrySequenceHoldDurationChart";
import entrySequenceCandidates from "./entry-sequence-candidates";
import type { VolatilityPoint } from "@/lib/system/types";
import { runtimeEntrySequences } from "@/lib/system/trading";

interface EntrySequenceChartRow extends RuntimeEntrySequenceCount {
    [key: string]: number | string;
}

export default function EntrySequenceMetrics({
    endTime,
    minEntryAbsLevel,
    maxEntryAbsLevel,
    startTime,
    volatilityMap,
}: {
    endTime?: number;
    minEntryAbsLevel?: number;
    maxEntryAbsLevel?: number;
    startTime?: number;
    volatilityMap: Record<string, VolatilityPoint[]>;
}) {
    return (
        <HeaderMetrics
            title={
                <Typography fontWeight="bold" variant="body1">
                    Entry Sequence
                </Typography>
            }
            rememberExpand="entry-sequence"
            defaultExpanded={false}
            headerCanBeClicked
        >
            {(expanded) => (
                <>
                    {expanded && (
                        <EntrySequenceMetricsContent
                            endTime={endTime}
                            minEntryAbsLevel={minEntryAbsLevel}
                            maxEntryAbsLevel={maxEntryAbsLevel}
                            startTime={startTime}
                            volatilityMap={volatilityMap}
                        />
                    )}
                </>
            )}
        </HeaderMetrics>
    );
}

function EntrySequenceMetricsContent({
    endTime,
    minEntryAbsLevel,
    maxEntryAbsLevel,
    startTime,
    volatilityMap,
}: {
    endTime?: number;
    minEntryAbsLevel?: number;
    maxEntryAbsLevel?: number;
    startTime?: number;
    volatilityMap: Record<string, VolatilityPoint[]>;
}) {
    const resolvedMinEntryAbsLevel =
        entrySequenceCandidates.threshold.resolve(minEntryAbsLevel);
    const resolvedMaxEntryAbsLevel =
        entrySequenceCandidates.threshold.resolveMax(maxEntryAbsLevel);
    const { entrySequenceCounts, entrySequenceIntervals } = useMemo(() => {
        const rangedVolatilityMap = runtimeEntrySequences.range.crop({
            endTimeMs: endTime,
            startTimeMs: startTime,
            volatilityMap,
        });
        const entrySignals = entrySequenceCandidates.build({
            minEntryAbsLevel,
            maxEntryAbsLevel,
            volatilityMap: rangedVolatilityMap,
        });

        return {
            entrySequenceCounts: runtimeEntrySequences.count({
                entrySignals,
                volatilityMap: rangedVolatilityMap,
            }),
            entrySequenceIntervals:
                runtimeEntrySequences.intervals.collect({
                    entrySignals,
                    volatilityMap: rangedVolatilityMap,
                }),
        };
    }, [endTime, minEntryAbsLevel, maxEntryAbsLevel, startTime, volatilityMap]);
    const chartData = useMemo(
        () =>
            entrySequenceCounts
                .filter((item) => item.total > 0)
                .map<EntrySequenceChartRow>((item) => ({ ...item })),
        [entrySequenceCounts],
    );
    const totalSequences = chartData.reduce((sum, item) => sum + item.total, 0);

    return (
        <Box>
            <Typography fontWeight={600} variant="body2">
                Entry sequences ({totalSequences})
            </Typography>
            <Typography color="text.secondary" variant="caption">
                Configured abs(level) {resolvedMinEntryAbsLevel === undefined ? "unbounded below" : `>= ${resolvedMinEntryAbsLevel}`}
                {resolvedMaxEntryAbsLevel !== undefined && ` and <= ${resolvedMaxEntryAbsLevel}`} candidates
                {" · current range"}
            </Typography>

            {chartData.length > 0 ? (
                <>
                    <Box sx={{ minWidth: 0 }}>
                        <ResponsiveContainer width="100%" height={300} minWidth={0}>
                            <PieChart>
                                <Pie
                                    data={chartData}
                                    dataKey="total"
                                    innerRadius="42%"
                                    nameKey="symbol"
                                    outerRadius="78%"
                                    paddingAngle={1}
                                >
                                    {chartData.map((item, index) => (
                                        <Cell
                                            fill={DEFAULT_COLORS[index % DEFAULT_COLORS.length]}
                                            key={item.symbol}
                                        />
                                    ))}
                                </Pie>
                                <Tooltip
                                    formatter={(value, _name, item) => {
                                        const payload = item.payload as RuntimeEntrySequenceCount;
                                        return [
                                            `${Number(value)} (LONG ${payload.long}, SHORT ${payload.short})`,
                                            payload.symbol,
                                        ];
                                    }}
                                />
                            </PieChart>
                        </ResponsiveContainer>
                    </Box>
                    <Box
                        sx={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: 0.5,
                            maxHeight: 150,
                            overflowY: "auto",
                        }}
                    >
                        {chartData.map((item, index) => (
                            <Chip
                                key={item.symbol}
                                label={`${item.symbol} ${item.total}`}
                                size="small"
                                sx={{
                                    borderColor: DEFAULT_COLORS[index % DEFAULT_COLORS.length],
                                    borderWidth: 2,
                                }}
                                title={`${item.symbol}: ${item.total} sequences (LONG ${item.long}, SHORT ${item.short})`}
                                variant="outlined"
                            />
                        ))}
                    </Box>
                    <EntrySequenceHoldDurationChart
                        intervals={entrySequenceIntervals}
                    />
                </>
            ) : (
                <Paper
                    variant="outlined"
                    sx={{ color: "text.secondary", mt: 1, p: 2, textAlign: "center" }}
                >
                    No entry sequences in this range
                </Paper>
            )}
        </Box>
    );
}
