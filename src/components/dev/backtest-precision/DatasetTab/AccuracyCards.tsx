"use client";

import { Box, Paper, Typography } from "@mui/material";

import type { FeatureGateCorrectness } from "@/lib/dev/feature-gate";

import MetricValue from "./MetricValue";
import pct from "./percent";

function AccuracyCard({ label, rate, caption, detail }: { label: string; rate: number | undefined; caption: string; detail: string }) {
    return (
        <Paper variant="outlined" sx={{ p: 1.25 }}>
            <MetricValue detail={detail}>
                <Typography color="text.secondary" component="span" variant="caption">{label}</Typography>
            </MetricValue>
            <Typography fontWeight={700} variant="h6" sx={{ fontVariantNumeric: "tabular-nums", lineHeight: 1.3 }}>{pct(rate)}</Typography>
            <Typography color="text.secondary" variant="caption" sx={{ fontVariantNumeric: "tabular-nums" }}>{caption}</Typography>
        </Paper>
    );
}

export default function AccuracyCards({ correctness }: { correctness: FeatureGateCorrectness }) {
    const { acceptedCorrect, acceptedResolved, correct, incorrect, maxScore, rejectedIncorrect } = correctness;
    return (
        <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", mt: 1 }}>
            <AccuracyCard label="Effectiveness" rate={correctness.effectiveness} caption="avg of accept & reject" detail={`(Accept-correct accuracy + Reject-wrong accuracy) / 2 = (${pct(correctness.acceptedCorrectRate)} + ${pct(correctness.rejectedIncorrectRate)}) / 2; n/a unless both exist.`} />
            <AccuracyCard label="Accept-correct accuracy" rate={correctness.acceptedCorrectRate} caption={`${acceptedCorrect} / ${correct}`} detail={`Accepted correct rows / correct candidates (score ≤ ${maxScore}) × 100 = ${acceptedCorrect} / ${correct} × 100; n/a when there are no correct candidates.`} />
            <AccuracyCard label="Reject-wrong accuracy" rate={correctness.rejectedIncorrectRate} caption={`${rejectedIncorrect} / ${incorrect}`} detail={`Rejected wrong rows / wrong candidates (score > ${maxScore}) × 100 = ${rejectedIncorrect} / ${incorrect} × 100; n/a when there are no wrong candidates.`} />
            <AccuracyCard label="Correct-pass accuracy" rate={correctness.passCorrectRate} caption={`${acceptedCorrect} / ${acceptedResolved}`} detail={`Accepted correct rows / accepted resolved rows × 100 = ${acceptedCorrect} / ${acceptedResolved} × 100. Unresolved rows are excluded; n/a when no accepted rows are resolved.`} />
        </Box>
    );
}
