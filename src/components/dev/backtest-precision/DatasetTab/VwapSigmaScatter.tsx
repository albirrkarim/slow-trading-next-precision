"use client";

import { Box, Checkbox, FormControlLabel, Paper, TextField, ToggleButton, ToggleButtonGroup, Typography, useTheme } from "@mui/material";
import { useMemo, useState } from "react";
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";

import HeaderMetrics from "@/components/ui/HeaderMetrics";
import type { FeatureGateDatasetRow } from "@/lib/dev/feature-gate";
import vwapSigma, { type VwapSigmaPoint, type VwapSigmaView } from "@/lib/dev/feature-gate/vwap-sigma";
import type { FeatureGateResult } from "@/lib/strategies/feature-gates";

import { rowKey } from "./DatasetTable";
import MetricValue from "./MetricValue";

function PointTooltip({ active, payload }: { active?: boolean; payload?: { payload: VwapSigmaPoint }[] }) {
    const point = active ? payload?.[0]?.payload : undefined;
    return point && (
        <Paper variant="outlined" sx={{ px: 1, py: 0.5 }}>
            <Typography fontWeight={700} variant="caption" display="block">{point.symbol} · score {point.missScore}{point.level !== undefined && ` · level ${point.level}`}</Typography>
            <Typography color="text.secondary" variant="caption" display="block">
                {point.dSigma.toFixed(2)}σ · day {point.day.toFixed(1)} · {new Date(point.t).toISOString().slice(0, 16).replace("T", " ")}
            </Typography>
            {point.accepted !== undefined && <Typography color="text.secondary" variant="caption" display="block">{point.accepted ? "accepted" : "rejected"}</Typography>}
        </Paper>
    );
}

/** Which colour series the chart draws. */
type SeriesVisibility = { green: boolean; red: boolean };

interface ScatterProps {
    rows: FeatureGateDatasetRow[];
    decisions: Map<string, FeatureGateResult>;
}

function ScatterBody({ rows, decisions, threshold, onThresholdChange, view, onViewChange, series, onSeriesChange }: ScatterProps & {
    series: SeriesVisibility;
    onSeriesChange: (next: SeriesVisibility) => void;
    threshold: number;
    onThresholdChange: (next: number) => void;
    view: VwapSigmaView;
    onViewChange: (next: VwapSigmaView) => void;
}) {
    const theme = useTheme();
    const split = useMemo(
        () => vwapSigma.split(rows, threshold, view, (row) => decisions.get(rowKey(row))?.allow),
        [rows, threshold, view, decisions],
    );

    return (
        <Box role="group" aria-label="VWAP sigma distribution">
            <Typography component="div" color="text.secondary" variant="caption">
                <MetricValue detail={`Resolved rows by month-to-date day (x) and |signal − monthly VWAP| / σ (y). Green: miss score ≤ ${threshold}; red: above.`}>
                    {split.correct.length} green · {split.wrong.length} red
                </MetricValue>
                {split.missing > 0 && <> · <MetricValue detail="Resolved rows in this view without a VWAP dSigma or anchor.">{split.missing} without σ</MetricValue></>}
            </Typography>
            <Box sx={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 1, my: 1 }}>
                <TextField label="Max correct score" size="small" type="number" value={threshold} sx={{ width: 140 }}
                    slotProps={{ htmlInput: { min: 0, step: 1 } }}
                    onChange={(event) => {
                        const next = Number(event.target.value);
                        if (event.target.value !== "" && Number.isInteger(next) && next >= 0) onThresholdChange(next);
                    }} />
                <ToggleButtonGroup exclusive size="small" value={view} onChange={(_, next: VwapSigmaView | null) => next && onViewChange(next)}>
                    <ToggleButton value="all">All</ToggleButton>
                    <ToggleButton value="accepted">Accepted</ToggleButton>
                    <ToggleButton value="rejected">Rejected</ToggleButton>
                </ToggleButtonGroup>
            </Box>
            <Box sx={{ height: 260 }}>
                <ResponsiveContainer>
                    <ScatterChart margin={{ bottom: 16, left: -16, right: 8, top: 8 }}>
                        <CartesianGrid stroke={theme.palette.divider} strokeDasharray="3 3" />
                        <XAxis dataKey="day" type="number" domain={[0, 31]} ticks={[0, 7, 14, 21, 28]} name="Day"
                            tick={{ fill: theme.palette.text.secondary, fontSize: 11 }}
                            label={{ fill: theme.palette.text.secondary, fontSize: 11, offset: -4, position: "insideBottom", value: "month to date (days)" }} />
                        <YAxis dataKey="dSigma" type="number" name="σ" tick={{ fill: theme.palette.text.secondary, fontSize: 11 }}
                            label={{ angle: -90, fill: theme.palette.text.secondary, fontSize: 11, offset: 24, position: "insideLeft", value: "dSigma" }} />
                        <ZAxis range={[14, 14]} />
                        <Tooltip content={<PointTooltip />} cursor={{ strokeDasharray: "3 3" }} />
                        {series.green && <Scatter data={split.correct} fill={theme.palette.success.main} fillOpacity={0.55} isAnimationActive={false} name="correct" />}
                        {series.red && <Scatter data={split.wrong} fill={theme.palette.error.main} fillOpacity={0.7} isAnimationActive={false} name="wrong" />}
                    </ScatterChart>
                </ResponsiveContainer>
            </Box>
            <Box sx={{ display: "flex", gap: 1 }}>
                <FormControlLabel label={`Green (≤ ${threshold}) · ${split.correct.length}`} slotProps={{ typography: { variant: "body2" } }}
                    control={<Checkbox checked={series.green} color="success" size="small"
                        onChange={(event) => onSeriesChange({ ...series, green: event.target.checked })} />} />
                <FormControlLabel label={`Red (> ${threshold}) · ${split.wrong.length}`} slotProps={{ typography: { variant: "body2" } }}
                    control={<Checkbox checked={series.red} color="error" size="small"
                        onChange={(event) => onSeriesChange({ ...series, red: event.target.checked })} />} />
            </Box>
        </Box>
    );
}

export default function VwapSigmaScatter({ defaultThreshold, ...props }: ScatterProps & { defaultThreshold: number }) {
    // Controls live outside the collapsible body so collapsing keeps the chosen threshold and view.
    const [threshold, setThreshold] = useState(defaultThreshold);
    const [view, setView] = useState<VwapSigmaView>("all");
    const [series, setSeries] = useState<SeriesVisibility>({ green: true, red: true });
    return (
        <HeaderMetrics defaultExpanded headerCanBeClicked rememberExpand="backtest-precision:vwap-sigma-distribution"
            sx={{ mt: 1.5 }} title={<Typography fontWeight={700} variant="body1">VWAP σ distribution</Typography>}>
            {(expanded) => expanded && <ScatterBody {...props} onThresholdChange={setThreshold}
                onSeriesChange={setSeries} onViewChange={setView} series={series} threshold={threshold} view={view} />}
        </HeaderMetrics>
    );
}
