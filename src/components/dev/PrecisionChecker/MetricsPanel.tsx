"use client";

import metrics from "@/lib/dev/precisionChecker/metrics";
import type { PrecisionCheckerRunResult } from "@/lib/dev/precisionChecker";
import {
    Box,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Typography,
} from "@mui/material";
import { useMemo } from "react";

export default function MetricsPanel({
    result,
}: {
    result: PrecisionCheckerRunResult;
}) {
    const rows = useMemo(() => metrics.build(result), [result]);

    return (
        <Box component="section" aria-label="Precision metrics" sx={{ mt: 2 }}>
            <Typography variant="body1" fontWeight={600} sx={{ mb: 1 }}>
                Metrics
            </Typography>
            <TableContainer sx={{ maxWidth: 720 }}>
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell>Metric</TableCell>
                            <TableCell align="right">Initial</TableCell>
                            <TableCell align="right">Production</TableCell>
                            <TableCell align="right">Backtest</TableCell>
                            <TableCell align="right">Diff</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {rows.map((row) => (
                            <TableRow key={row.key} hover>
                                <TableCell>{row.metric}</TableCell>
                                <TableCell align="right">{row.initial}</TableCell>
                                <TableCell align="right">{row.production}</TableCell>
                                <TableCell align="right">{row.backtest}</TableCell>
                                <TableCell align="right">{row.diff}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>
        </Box>
    );
}
