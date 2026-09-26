"use client";

import metrics, {
    type MetricSeverity,
    type PrecisionCheckerMetricCategory,
} from "@/lib/dev/precisionChecker/metrics";
import type { PrecisionCheckerRunResult } from "@/lib/dev/precisionChecker";
import { alpha } from "@mui/material/styles";
import {
    Box,
    Card,
    CardContent,
    Chip,
    Divider,
    Grid,
    Stack,
    Typography,
    type Theme,
} from "@mui/material";
import { useMemo } from "react";

/** Solid palette color per severity — category accent and score chip. */
function severityColor(theme: Theme, severity: MetricSeverity): string {
    switch (severity) {
        case "match":
            return theme.palette.success.main;
        case "minor":
            return theme.palette.warning.main;
        case "major":
            return theme.palette.error.main;
        default:
            return theme.palette.divider;
    }
}

function CategoryCard({ category }: { category: PrecisionCheckerMetricCategory }) {
    return (
        <Card
            variant="outlined"
            sx={(theme) => ({
                borderLeftWidth: 4,
                borderLeftColor: severityColor(theme, category.severity),
                bgcolor: alpha(
                    severityColor(theme, category.severity),
                    category.severity === "none" ? 0.02 : 0.06,
                ),
            })}
        >
            <CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 } }}>
                <Stack
                    direction="row"
                    alignItems="center"
                    justifyContent="space-between"
                >
                    <Typography variant="body2" fontWeight={700}>
                        {category.title}
                    </Typography>
                    <Chip
                        size="small"
                        label={
                            category.score == null ? "n/a" : `${category.score}/100`
                        }
                        sx={(theme) => ({
                            fontWeight: 700,
                            color: theme.palette.common.white,
                            bgcolor: severityColor(theme, category.severity),
                        })}
                    />
                </Stack>
                <Divider sx={{ my: 1 }} />
                <Stack spacing={0.25} component="ul" sx={{ m: 0, pl: 1.5 }}>
                    {category.rows.map((row) => (
                        <Typography
                            key={row.key}
                            component="li"
                            variant="caption"
                            sx={(theme) => ({
                                color:
                                    row.severity === "none"
                                        ? "text.secondary"
                                        : severityColor(theme, row.severity),
                            })}
                        >
                            {row.metric}:{" "}
                            {row.production !== "—" &&
                                `${row.production} → ${row.backtest} · `}
                            {row.diff}
                        </Typography>
                    ))}
                </Stack>
            </CardContent>
        </Card>
    );
}

export default function MetricsPanel({
    result,
}: {
    result: PrecisionCheckerRunResult;
}) {
    const categories = useMemo(() => metrics.build(result), [result]);

    return (
        <Box component="section" aria-label="Precision metrics" sx={{ mt: 2 }}>
            <Typography variant="body1" fontWeight={600} sx={{ mb: 1 }}>
                Metrics
            </Typography>
            <Grid container spacing={1.5}>
                {categories.map((category) => (
                    <Grid key={category.key} size={{ xs: 12, md: 4 }}>
                        <CategoryCard category={category} />
                    </Grid>
                ))}
            </Grid>
        </Box>
    );
}
