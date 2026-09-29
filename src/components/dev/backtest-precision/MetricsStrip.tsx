"use client";

import Button from "@mui/material/Button";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { useEffect } from "react";

import type {
    BacktestLeaderboardEntry,
    BacktestLeaderboardMetrics,
} from "@/lib/dev/backtestPrecision/leaderboards";
import { readLeaf } from "@/lib/dev/backtestPrecision/leaderboards/leaves";

import {
    HEADER_GROUPS,
    HeaderTooltip,
    TABLE_GRID_SX,
    TABLE_HEAD_SX,
    TEXT_FIELDS,
    formatCell,
    formatMinEquity,
} from "./Leaderboards";
import type { BacktestConfig } from "./types";
import type { LazyArtifact } from "./use-backtest-artifacts";

/** Saved-At is a list-entry concept — the live result has nothing saved yet. */
const GROUPS = HEADER_GROUPS.filter((group) => group.id !== "t");

export default function MetricsStrip({
    artifact,
    backtestConfig,
}: {
    artifact: LazyArtifact<BacktestLeaderboardMetrics>;
    backtestConfig: BacktestConfig;
}) {
    const { data, ensure, error } = artifact;

    // Fetched eagerly once a run's cacheKey exists — this strip is the
    // headline readout, not an expandable section.
    useEffect(() => {
        void ensure();
    }, [ensure]);

    const entry = {
        backtestConfig,
        id: "current",
        leaderboard: data,
        t: 0,
    } as unknown as BacktestLeaderboardEntry;

    return (
        <TableContainer
            sx={{ borderBottom: 1, borderColor: "divider", px: 1, py: 0.5 }}
        >
            {error && (
                <Typography
                    component="div"
                    sx={{ color: "error.main", fontSize: "0.7rem" }}
                >
                    {error}
                </Typography>
            )}
            <Table size="small" sx={TABLE_GRID_SX}>
                <TableHead sx={TABLE_HEAD_SX}>
                    <TableRow>
                        {GROUPS.map((group) =>
                            group.children ? (
                                <TableCell
                                    align="center"
                                    colSpan={group.children.length}
                                    key={group.id}
                                >
                                    <HeaderTooltip title={group.tooltip}>
                                        <Button color="inherit" size="small">
                                            {group.label}
                                        </Button>
                                    </HeaderTooltip>
                                </TableCell>
                            ) : (
                                <TableCell
                                    align={group.align ?? "left"}
                                    key={group.id}
                                    rowSpan={2}
                                >
                                    <HeaderTooltip title={group.tooltip}>
                                        <span>{group.label}</span>
                                    </HeaderTooltip>
                                </TableCell>
                            ),
                        )}
                    </TableRow>
                    <TableRow>
                        {GROUPS.flatMap((group) =>
                            (group.children ?? []).map((child) => (
                                <TableCell align="center" key={child.id}>
                                    <HeaderTooltip title={child.tooltip}>
                                        <span>{child.label}</span>
                                    </HeaderTooltip>
                                </TableCell>
                            )),
                        )}
                    </TableRow>
                </TableHead>
                <TableBody>
                    <TableRow>
                        {GROUPS.flatMap((group) =>
                            group.children ?? [group],
                        ).map((leaf) => {
                            const value = readLeaf(entry, leaf.id);
                            return (
                                <TableCell key={leaf.id}>
                                    {leaf.id === "minEquity"
                                        ? formatMinEquity(entry)
                                        : leaf.id === "label"
                                          ? backtestConfig.name ||
                                            backtestConfig.range ||
                                            "current"
                                          : TEXT_FIELDS.get(leaf.id)?.(value) ??
                                            formatCell(leaf.id, value)}
                                </TableCell>
                            );
                        })}
                    </TableRow>
                </TableBody>
            </Table>
        </TableContainer>
    );
}
