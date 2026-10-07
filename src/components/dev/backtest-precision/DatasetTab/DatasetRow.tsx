"use client";

import { Box, TableCell, TableRow, Typography } from "@mui/material";

import TradeFeaturePreview from "@/components/reports/TradesTableSection/TradeFeaturePreview";
import ButtonDialog from "@/components/ui/ButtonDialog";
import JsonTreeViewer from "@/components/ui/JsonTreeViewer";
import type { FeatureGateDatasetRow } from "@/lib/dev/feature-gate";
import format from "@/lib/system/utils/format";

/** Compact `B0→B-1→B-2→T0` rendering of the row's level sequence. */
function sequenceLabel(row: FeatureGateDatasetRow): string {
    return row.sequences.map((point) => `${point.l}${point.lvl}`).join("→");
}

export default function DatasetRow({ row }: { row: FeatureGateDatasetRow }) {
    const signal = row.sequences[0];

    return (
        <TableRow hover>
            <TableCell sx={{ verticalAlign: "top" }}>
                <Typography
                    title={row.t !== undefined ? format.timeForLog(row.t) : "not captured"}
                    variant="caption"
                >
                    {row.t !== undefined ? format.timeMsToReadable(row.t, "DD MMM HH:mm") : "—"}
                </Typography>
            </TableCell>
            <TableCell>
                <TradeFeaturePreview
                    entryTimeMs={row.t}
                    feature={row.feature}
                    signal={signal}
                    symbol={row.symbol}
                />
                {!row.feature && <Typography variant="caption">—</Typography>}
            </TableCell>
            <TableCell sx={{ verticalAlign: "top" }}>
                <Typography
                    title={row.sequences.map((point) => point.id).join(" → ")}
                    variant="caption"
                >
                    {sequenceLabel(row)}
                </Typography>
            </TableCell>
            <TableCell align="right" sx={{ verticalAlign: "top" }}>
                <Typography
                    color={row.resolved ? "text.primary" : "text.secondary"}
                    title={row.resolved ? undefined : "Unresolved — no reversal formed"}
                    variant="caption"
                >
                    {row.resolved ? row.missScore : "…"}
                </Typography>
            </TableCell>
            <TableCell sx={{ verticalAlign: "top" }}>
                {/* BTEST:FEATURE_GATE_DATASET — inspect the complete dataset row. */}
                <ButtonDialog
                    maxWidth="md"
                    size="small"
                    title="JSON"
                    titleLong={`Dataset: ${row.symbol} · ${signal?.id ?? "unknown signal"}`}
                >
                    {() => (
                        <Box sx={{ p: 2 }}>
                            <JsonTreeViewer
                                ariaLabel={`${row.symbol} dataset JSON`}
                                value={row}
                            />
                        </Box>
                    )}
                </ButtonDialog>
            </TableCell>
        </TableRow>
    );
}
