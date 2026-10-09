"use client";

import { Box, TableCell, TableRow, Typography } from "@mui/material";

import TradeFeaturePreview from "@/components/reports/TradesTableSection/TradeFeaturePreview";
import ButtonDialog from "@/components/ui/ButtonDialog";
import JsonTreeViewer from "@/components/ui/JsonTreeViewer";
import type {
    FeatureGateDatasetOption,
    FeatureGateDatasetRow,
} from "@/lib/dev/feature-gate";
import type { FeatureGateResult } from "@/lib/strategies/feature-gates";
import format from "@/lib/system/utils/format";

import DatasetChartDialog from "./DatasetChartDialog";

/** Compact `B0→B-1→B-2→T0` rendering of the row's level sequence. */
export function sequenceLabel(row: FeatureGateDatasetRow): string {
    return row.sequences.map((point) => `${point.l}${point.lvl}`).join("→");
}

export default function DatasetRow({
    row,
    hash,
    option,
    approvalMessage,
    entry,
    evaluated,
}: {
    row: FeatureGateDatasetRow;
    hash: string;
    option?: FeatureGateDatasetOption;
    /** Explanation from the gate invocation that accepted this row during evaluation. */
    approvalMessage?: string;
    entry?: FeatureGateResult;
    evaluated?: boolean;
}) {
    const signal = row.sequences[0];

    return (
        <TableRow hover>
            <TableCell sx={{ verticalAlign: "top" }}>
                <Typography
                    title={row.t !== undefined ? format.timeForLog(row.t) : "not captured"}
                    variant="body1"
                >
                    {row.t !== undefined ? format.timeMsToReadable(row.t, "DD MMM YYYY HH:mm") : "—"}
                </Typography>
            </TableCell>
            <TableCell>
                {approvalMessage !== undefined && (
                    <Typography
                        component="div"
                        sx={{ mb: 1, overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}
                        variant="body2"
                    >
                        <Box component="span" sx={{ fontWeight: 700 }}>Gate approved: </Box>
                        {approvalMessage}
                    </Typography>
                )}
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
                    aria-label={sequenceLabel(row)}
                    title={row.sequences.map((point) => point.id).join(" → ")}
                    variant="body1"
                >
                    {row.sequences.map((point, index) => (
                        <Box component="span" key={`${point.id}:${index}`}>
                            {index > 0 && <Box component="span" sx={{ color: "text.secondary" }}>→</Box>}
                            <Box component="span" sx={{ color: point.l === "T" ? "success.main" : "error.main", fontWeight: 700 }}>
                                {point.l}{point.lvl}
                            </Box>
                        </Box>
                    ))}
                </Typography>
            </TableCell>
            <TableCell align="right" sx={{ verticalAlign: "top" }}>
                <Typography
                    color={row.resolved ? "text.primary" : "text.secondary"}
                    fontWeight={row.resolved ? 700 : 400}
                    title={row.resolved ? undefined : "Unresolved — no reversal formed"}
                    variant="body1"
                >
                    {row.resolved ? row.missScore : "…"}
                </Typography>
            </TableCell>
            <TableCell sx={{ verticalAlign: "top" }}>
                <Typography color={entry?.allow ? "success.main" : entry ? "error.main" : "text.secondary"}
                    fontWeight={700} variant="body1">
                    {entry ? entry.allow ? "Pass" : "Block" : evaluated ? "Skipped" : "…"}
                </Typography>
                {entry && <Typography color="text.secondary" sx={{ overflowWrap: "anywhere" }} variant="body1">
                    {entry.message}
                </Typography>}
            </TableCell>
            <TableCell sx={{ verticalAlign: "top" }}>
                <Box sx={{ alignItems: "center", display: "flex", gap: 0.5 }}>
                    <DatasetChartDialog
                        exchangeType={option?.exchangeType}
                        hash={hash}
                        marketType={option?.marketType}
                        row={row}
                    />
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
                </Box>
            </TableCell>
        </TableRow>
    );
}
