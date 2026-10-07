"use client";

import { Box, Table, TableBody, TableCell, TableContainer, TableRow, Typography } from "@mui/material";

import type { FeatureGateMetrics } from "@/lib/dev/feature-gate";

import MetricValue from "./MetricValue";
import ScoreDistribution from "./ScoreDistribution";

/** Displays a ratio as a percentage, preserving unavailable denominators. */
const pct = (value: number | undefined): string =>
    value === undefined ? "n/a" : `${(value * 100).toFixed(1)}%`;

function MetricLine({ label, value, detail }: { label: string; value: string; detail: string }) {
    return (
        <TableRow>
            <TableCell>
                <MetricValue detail={detail}>
                    <Typography color="text.secondary" component="span" variant="body2">{label}</Typography>
                </MetricValue>
            </TableCell>
            <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                <Typography component="span" fontWeight={700} variant="body2">{value}</Typography>
            </TableCell>
        </TableRow>
    );
}

export default function MetricsCard({ metrics, title }: { metrics: FeatureGateMetrics; title: string }) {
    const distribution = metrics.acceptedScoreDistribution;
    const acceptedResolved = distribution["0"] + distribution["1"] + distribution["2"] + distribution["3+"];
    return (
        <Box>
            <Typography fontWeight={700} variant="body2">{title}</Typography>
            <Typography component="div" color="text.secondary" variant="caption">
                <MetricValue detail="Evaluable rows = accepted + rejected; rows with missing capture inputs or invalid resolved labels are excluded.">{metrics.total} rows</MetricValue> ·{" "}
                <MetricValue detail="Count of evaluable rows whose sequence closed with a reversal and a valid miss score.">{metrics.resolved} resolved</MetricValue> ·{" "}
                <MetricValue detail="Count of evaluable rows where the selected feature gate returned no rejection reason, including unresolved rows.">{metrics.accepted} accepted</MetricValue> ·{" "}
                <MetricValue detail={`Rejected rows = evaluable rows − accepted rows = ${metrics.total} − ${metrics.accepted}.`}>{metrics.rejected} rejected</MetricValue> ·{" "}
                <MetricValue detail="Count of dataset rows skipped because capture time, features, signal or symbol are missing/invalid, or a resolved miss score is invalid.">{metrics.skipped} skipped</MetricValue>
            </Typography>
            <TableContainer>
                <Table size="small" aria-label="Feature gate metrics" sx={{ "& .MuiTableCell-root": { px: 1 } }}>
                    <TableBody>
                        <MetricLine label="Acceptance rate" value={`${pct(metrics.acceptanceRate)} (${metrics.accepted}/${metrics.total})`} detail={`Accepted rows / evaluable rows × 100 = ${metrics.accepted} / ${metrics.total} × 100. Includes unresolved rows; returns 0% if no rows are evaluable.`} />
                        <MetricLine label="Accepted quality" value={pct(metrics.acceptedQuality)} detail={`Accepted score-zero rows / accepted resolved rows × 100 = ${distribution["0"]} / ${acceptedResolved} × 100. Unresolved rows are excluded; n/a when no accepted rows are resolved.`} />
                        <MetricLine label="Good opportunities retained" value={pct(metrics.goodRetained)} detail="Accepted score-zero rows / all evaluable resolved score-zero rows × 100. The denominator includes accepted and rejected rows; n/a when there are no score-zero rows." />
                        <MetricLine label="Bad opportunities blocked" value={pct(metrics.badBlocked)} detail="Rejected score-positive rows / all evaluable resolved score-positive rows × 100. Positive means miss score greater than zero; n/a when there are no score-positive rows." />
                    </TableBody>
                </Table>
            </TableContainer>
            <ScoreDistribution distribution={distribution} />
            <TableContainer>
                <Table size="small" aria-label="Accepted score summary" sx={{ "& .MuiTableCell-root": { px: 1 } }}>
                    <TableBody>
                        <MetricLine label="Average score" value={distribution.avgScore?.toFixed(2) ?? "n/a"} detail={`Sum of actual miss scores / accepted resolved rows (${acceptedResolved}). Uses each exact score, including scores grouped into 3+; n/a when none exist.`} />
                        <MetricLine label="Worst score" value={distribution.worstScore?.toString() ?? "n/a"} detail="Maximum actual miss score among accepted resolved rows; n/a when none exist." />
                    </TableBody>
                </Table>
            </TableContainer>
            {metrics.topRejections.length > 0 && (
                <Box sx={{ mt: 1.5 }}>
                    <Typography fontWeight={700} variant="body2">Top rejections</Typography>
                    {metrics.topRejections.map((rejection) => (
                        <Typography key={rejection.reason} component="div" color="text.secondary" variant="caption" display="block" sx={{ overflowWrap: "anywhere" }}>
                            <MetricValue detail="Count of evaluable rows where the selected feature gate returned this exact rejection reason.">{rejection.count}×</MetricValue> {rejection.reason}
                        </Typography>
                    ))}
                </Box>
            )}
        </Box>
    );
}
