"use client";

import { Box, Divider, Typography } from "@mui/material";

import type { FeatureGateMetrics } from "@/lib/dev/feature-gate";

const pct = (value: number | undefined): string =>
    value === undefined ? "n/a" : `${(value * 100).toFixed(1)}%`;

function MetricLine({ label, value }: { label: string; value: string }) {
    return (
        <Box sx={{ display: "flex", gap: 1 }}>
            <Typography
                color="text.secondary"
                sx={{ flex: 1, minWidth: 0 }}
                variant="caption"
            >
                {label}
            </Typography>
            <Typography fontWeight={600} variant="caption">
                {value}
            </Typography>
        </Box>
    );
}

/**
 * One dataset's gate metrics — the five evaluation measures from
 * docs/STRATEGY/FEATURE_EXTRACTION.md plus the top rejection reasons.
 */
export default function MetricsCard({
    metrics,
    title,
}: {
    metrics: FeatureGateMetrics;
    title: string;
}) {
    const distribution = metrics.acceptedScoreDistribution;
    return (
        <Box
            sx={{
                border: 1,
                borderColor: "divider",
                borderRadius: 1.5,
                p: 1,
            }}
        >
            <Typography fontWeight={700} variant="subtitle2">
                {title}
            </Typography>
            <Typography color="text.secondary" variant="caption">
                {metrics.total} rows · {metrics.resolved} resolved ·{" "}
                {metrics.accepted} accepted · {metrics.rejected} rejected ·{" "}
                {metrics.skipped} skipped
            </Typography>
            <Divider sx={{ my: 0.5 }} />
            <MetricLine
                label="Acceptance rate (accepted / all rows)"
                value={`${pct(metrics.acceptanceRate)} (${metrics.accepted}/${metrics.total})`}
            />
            <MetricLine
                label="Accepted quality (score-0 / accepted resolved)"
                value={pct(metrics.acceptedQuality)}
            />
            <MetricLine
                label="Good opportunities retained (score-0 kept)"
                value={pct(metrics.goodRetained)}
            />
            <MetricLine
                label="Bad opportunities blocked (score>0 rejected)"
                value={pct(metrics.badBlocked)}
            />
            <MetricLine
                label="Accepted score distribution (0/1/2/3+ · avg · worst)"
                value={
                    `0:${distribution["0"]} 1:${distribution["1"]} ` +
                    `2:${distribution["2"]} 3+:${distribution["3+"]}` +
                    (distribution.avgScore !== undefined
                        ? ` · avg ${distribution.avgScore.toFixed(2)} · worst ${distribution.worstScore}`
                        : "")
                }
            />
            {metrics.topRejections.length > 0 && (
                <>
                    <Divider sx={{ my: 0.5 }} />
                    <Typography
                        color="text.secondary"
                        display="block"
                        fontWeight={600}
                        variant="caption"
                    >
                        Top rejections
                    </Typography>
                    {metrics.topRejections.map((rejection) => (
                        <Typography
                            color="text.secondary"
                            display="block"
                            key={rejection.reason}
                            sx={{
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                            }}
                            title={rejection.reason}
                            variant="caption"
                        >
                            {rejection.count}× {rejection.reason}
                        </Typography>
                    ))}
                </>
            )}
        </Box>
    );
}
