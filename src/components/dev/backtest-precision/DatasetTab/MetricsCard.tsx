"use client";

import { Box, Table, TableBody, TableCell, TableContainer, TableRow, Typography } from "@mui/material";

import type { FeatureGateCorrectness, FeatureGateMetrics } from "@/lib/dev/feature-gate";

import AccuracyCards from "./AccuracyCards";
import MetricValue from "./MetricValue";
import pct from "./percent";
import ScoreDistribution from "./ScoreDistribution";

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

function CandidateLines({ correctness }: { correctness: FeatureGateCorrectness }) {
    const { correct, incorrect, maxScore } = correctness;
    return (
        <>
            <MetricLine label={`Correct candidates (score ≤ ${maxScore})`} value={String(correct)} detail={`Resolved rows with miss score ≤ ${maxScore} — entries the gate should accept. Unresolved rows are excluded.`} />
            <MetricLine label={`Wrong candidates (score > ${maxScore})`} value={String(incorrect)} detail={`Resolved rows with miss score > ${maxScore} — entries the gate should reject.`} />
        </>
    );
}

export default function MetricsCard({ metrics, title }: { metrics: FeatureGateMetrics; title: string }) {
    const distribution = metrics.acceptedScoreDistribution;
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
                        <CandidateLines correctness={metrics.correctness} />
                    </TableBody>
                </Table>
            </TableContainer>
            <AccuracyCards correctness={metrics.correctness} />
            <ScoreDistribution distribution={distribution} />
            {metrics.topRejections.length > 0 && (
                <Box sx={{ mt: 1.5 }}>
                    <Typography fontWeight={700} variant="body1">Top rejections</Typography>
                    {metrics.topRejections.map((rejection) => (
                        <Typography key={rejection.reason} component="div" color="text.secondary" variant="body1" display="block" sx={{ overflowWrap: "anywhere" }}>
                            <MetricValue detail={`Grouped reason (measured values normalized to #). One real example: "${rejection.sample}"`}>{rejection.count}×</MetricValue>{" "}
                            {rejection.reason}
                        </Typography>
                    ))}
                </Box>
            )}
        </Box>
    );
}
