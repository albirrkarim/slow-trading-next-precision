"use client";

import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteIcon from "@mui/icons-material/Delete";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import StarIcon from "@mui/icons-material/Star";
import StarOutlineIcon from "@mui/icons-material/StarOutline";
import UploadIcon from "@mui/icons-material/Upload";
import {
    Box,
    IconButton,
    TableCell,
    TableRow,
    Tooltip,
} from "@mui/material";

import type { BacktestLeaderboardEntry } from "@/lib/dev/backtestPrecision/leaderboards";
import type { BacktestConfig } from "../types";

import type { HeaderGroup } from "./columns";
import { formatCell, INVERT_FIELDS, TEXT_FIELDS } from "./fields";
import { formatMinEquity, formatNumber, formatTime, getGradientColor } from "./format";

export function LeaderboardRow(props: {
    columnRanges: Map<string, { min: number; max: number }>;
    entry: BacktestLeaderboardEntry;
    gradientValue: (entry: BacktestLeaderboardEntry, fieldId: string) => unknown;
    headerGroups: HeaderGroup[];
    leafValue: (entry: BacktestLeaderboardEntry, fieldId: string) => unknown;
    onApplyConfig?: (config: BacktestConfig) => void;
    onCopyConfig: (entry: BacktestLeaderboardEntry) => void;
    onRemove: (id: string) => void;
    onRunEntry?: (entry: BacktestLeaderboardEntry) => void;
    onToggleFavorite: (entry: BacktestLeaderboardEntry) => void;
}) {
    const {
        columnRanges,
        entry,
        gradientValue,
        headerGroups,
        leafValue,
        onApplyConfig,
        onCopyConfig,
        onRemove,
        onRunEntry,
        onToggleFavorite,
    } = props;

    const renderCell = (entryRow: BacktestLeaderboardEntry, fieldId: string) => {
        const value = leafValue(entryRow, fieldId);
        const range = columnRanges.get(fieldId);
        const gradientRaw = gradientValue(entryRow, fieldId);
        const numeric =
            typeof gradientRaw === "number" ? gradientRaw : undefined;
        const background = range
            ? getGradientColor(numeric, range.min, range.max, INVERT_FIELDS.has(fieldId))
            : "inherit";
        return (
            <TableCell key={fieldId} sx={{ backgroundColor: background }}>
                {fieldId === "profileScore"
                    ? formatNumber(numeric)
                    : fieldId === "minEquity"
                    ? formatMinEquity(entryRow)
                    : fieldId === "label"
                      ? entryRow.label ??
                      ((entryRow.backtestConfig as BacktestConfig)?.name ||
                          (entryRow.backtestConfig as BacktestConfig)?.range ||
                          entryRow.id)
                    : fieldId === "t"
                      ? formatTime(entryRow.t)
                      : TEXT_FIELDS.get(fieldId)?.(value) ??
                        formatCell(fieldId, value)}
            </TableCell>
        );
    };

    return (
        <TableRow hover>
            <TableCell>
                <Tooltip
                    title={
                        entry.favorite === true
                            ? "Remove from favorites"
                            : "Mark as favorite"
                    }
                >
                    <IconButton
                        aria-label={
                            entry.favorite === true
                                ? "Remove from favorites"
                                : "Mark as favorite"
                        }
                        onClick={() =>
                            void onToggleFavorite(
                                entry,
                            )
                        }
                        size="small"
                        sx={{
                            color:
                                entry.favorite ===
                                true
                                    ? "warning.main"
                                    : undefined,
                        }}
                    >
                        {entry.favorite === true ? (
                            <StarIcon fontSize="small" />
                        ) : (
                            <StarOutlineIcon fontSize="small" />
                        )}
                    </IconButton>
                </Tooltip>
            </TableCell>
            {headerGroups.flatMap((group) =>
                (group.children ?? [{ id: group.id }]).map((leaf) =>
                    renderCell(entry, leaf.id),
                ),
            )}
            <TableCell>
                <Box
                    sx={{
                        display: "flex",
                        gap: 0.5,
                        justifyContent: "center",
                    }}
                >
                    <Tooltip title="Copy settings JSON (paste in Settings → Backup → Restore)">
                        <IconButton
                            aria-label="Copy config"
                            onClick={() => void onCopyConfig(entry)}
                            size="small"
                        >
                            <ContentCopyIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                    {onApplyConfig && (
                        <Tooltip title="Load into the backtest form">
                            <IconButton
                                aria-label="Load config"
                                onClick={() =>
                                    onApplyConfig(
                                        entry.backtestConfig as BacktestConfig,
                                    )
                                }
                                size="small"
                            >
                                <UploadIcon fontSize="small" />
                            </IconButton>
                        </Tooltip>
                    )}
                    {onRunEntry && (
                        <Tooltip title="Load and run">
                            <IconButton
                                aria-label="Run config"
                                onClick={() => onRunEntry(entry)}
                                size="small"
                            >
                                <PlayArrowIcon fontSize="small" />
                            </IconButton>
                        </Tooltip>
                    )}
                    <Tooltip title="Delete entry">
                        <IconButton
                            aria-label="Delete entry"
                            onClick={() => void onRemove(entry.id)}
                            size="small"
                        >
                            <DeleteIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                </Box>
            </TableCell>
        </TableRow>
    );
}
