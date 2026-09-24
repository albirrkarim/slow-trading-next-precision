"use client";

import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteIcon from "@mui/icons-material/Delete";
import LeaderboardIcon from "@mui/icons-material/Leaderboard";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import UploadIcon from "@mui/icons-material/Upload";
import {
    Box,
    Button,
    CircularProgress,
    IconButton,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    TableSortLabel,
    Tooltip,
    Typography,
} from "@mui/material";
import { grey } from "@mui/material/colors";
import axios from "axios";
import { useCallback, useEffect, useMemo, useState } from "react";
import ButtonDialog from "@/components/ui/ButtonDialog";
import { endpoints } from "../../endpoints";
import type { BacktestLeaderboardEntry } from "@/lib/dev/backtestPrecision/leaderboards";
import type { BacktestConfig } from "./types";

type Order = "asc" | "desc";

interface LeaderboardsProps {
    onApplyConfig?: (config: BacktestConfig) => void;
    onRunConfig?: (config: BacktestConfig) => void | Promise<void>;
}

interface LeaderboardsContentProps extends LeaderboardsProps {
    onClose: () => void;
}

/** ms -> compact human string. */
function msToHuman(ms?: number) {
    if (!ms || ms <= 0) return "0s";
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ${min % 60}m`;
    const days = Math.floor(hr / 24);
    return `${days}d ${hr % 24}h`;
}

function formatPct(value: number | undefined, fraction = false) {
    if (value == null || Number.isNaN(value)) return "-";
    const pct = fraction ? value * 100 : value;
    return `${pct.toFixed(2)}%`;
}

function formatNumber(value: number | undefined) {
    if (value == null || Number.isNaN(value)) return "-";
    return value.toFixed(2);
}

function formatTime(t?: number) {
    if (!t) return "-";
    return new Date(t).toLocaleString();
}

/** nested getter for sortable leaf ids like "leaderboard.monthlyGain.avg". */
function getNested(obj: unknown, path: string) {
    return path
        .split(".")
        .reduce<unknown>(
            (acc, key) =>
                acc && typeof acc === "object"
                    ? (acc as Record<string, unknown>)[key]
                    : undefined,
            obj,
        );
}

/** Red-green translucent gradient for cell shading relative to a column range. */
function getGradientColor(
    value: number | undefined,
    min = 0,
    max = 1,
    invert = false,
): string {
    if (value == null || Number.isNaN(value)) return "inherit";
    if (max === min) {
        return invert ? "rgba(255, 50, 50, 0.18)" : "rgba(50, 255, 100, 0.18)";
    }
    const ratio = Math.max(0, Math.min(1, (value - min) / (max - min)));
    const r = invert ? 1 - ratio : ratio;
    const red = Math.round(255 * (1 - r));
    const green = Math.round(255 * r);
    return `rgba(${red}, ${green}, 100, 0.18)`;
}

interface HeaderGroup {
    id: string;
    label: string;
    align?: "left" | "right" | "center";
    children?: { id: string; label: string }[];
    tooltip?: string;
}

const HEADER_GROUPS: HeaderGroup[] = [
    { id: "label", label: "Label", tooltip: "Saved run label" },
    { id: "t", label: "Saved At", tooltip: "When the run was saved" },
    { id: "leaderboard.gainPct", label: "Gain", align: "right", tooltip: "(final - starting) / starting balance" },
    { id: "leaderboard.winRate", label: "Win Rate", align: "right", tooltip: "Winning closed positions / total closed" },
    { id: "leaderboard.positionsClosed", label: "Trades", align: "right", tooltip: "Closed positions" },
    { id: "leaderboard.sharpeRatio", label: "Sharpe", align: "right", tooltip: "Monthly-return Sharpe ratio" },
    {
        id: "leaderboard.maxPortfolioDrawdown",
        label: "Portfolio DD",
        align: "center",
        tooltip: "(total - floating) / total per snapshot — unrealized-loss drag",
        children: [
            { id: "leaderboard.maxPortfolioDrawdown.avg", label: "avg" },
            { id: "leaderboard.maxPortfolioDrawdown.max", label: "max" },
        ],
    },
    {
        id: "leaderboard.maxFloatingDrawdown",
        label: "Floating DD",
        align: "center",
        tooltip: "Floating drag relative to deployed open notional",
        children: [
            { id: "leaderboard.maxFloatingDrawdown.avg", label: "avg" },
            { id: "leaderboard.maxFloatingDrawdown.max", label: "max" },
        ],
    },
    { id: "leaderboard.bearMarketProofRatio", label: "Bear Proof", align: "right", tooltip: "Portfolio resilience inside detected bear windows" },
    {
        id: "leaderboard.monthlyGain",
        label: "Monthly Gain",
        align: "center",
        tooltip: "Realized monthly profit / month-start total",
        children: [
            { id: "leaderboard.monthlyGain.min", label: "min" },
            { id: "leaderboard.monthlyGain.avg", label: "avg" },
            { id: "leaderboard.monthlyGain.max", label: "max" },
        ],
    },
    { id: "leaderboard.avgMonthlyProfitPct", label: "Avg Monthly", align: "right", tooltip: "Average monthly profit vs starting balance" },
    { id: "leaderboard.balanceTradesScore", label: "Trades Bal", align: "right", tooltip: "Evenness of trades across coins (0-100%)" },
    {
        id: "leaderboard.capitalEfficiency",
        label: "Capital Eff",
        align: "center",
        tooltip: "Held ratio + turnover scores",
        children: [
            { id: "leaderboard.capitalEfficiency.hrScore", label: "HR" },
            { id: "leaderboard.capitalEfficiency.trScore", label: "TR" },
            { id: "leaderboard.capitalEfficiency.score", label: "Final" },
        ],
    },
    {
        id: "leaderboard.emptyBalance",
        label: "Empty Balance",
        align: "center",
        tooltip: "Durations the spendable balance stayed below trading minimum",
        children: [
            { id: "leaderboard.emptyBalance.min", label: "min" },
            { id: "leaderboard.emptyBalance.avg", label: "avg" },
            { id: "leaderboard.emptyBalance.max", label: "max" },
        ],
    },
];

const FRACTION_FIELDS = new Set([
    "leaderboard.maxPortfolioDrawdown.avg",
    "leaderboard.maxPortfolioDrawdown.max",
    "leaderboard.maxFloatingDrawdown.avg",
    "leaderboard.maxFloatingDrawdown.max",
]);

const SCORE_FIELDS = new Set([
    "leaderboard.balanceTradesScore",
    "leaderboard.capitalEfficiency.hrScore",
    "leaderboard.capitalEfficiency.trScore",
    "leaderboard.capitalEfficiency.score",
]);

const DURATION_FIELDS = new Set([
    "leaderboard.emptyBalance.min",
    "leaderboard.emptyBalance.avg",
    "leaderboard.emptyBalance.max",
]);

const PLAIN_FIELDS = new Set(["leaderboard.positionsClosed", "leaderboard.sharpeRatio"]);

/** Total leaf columns plus the trailing Actions column. */
const TABLE_COLSPAN =
    HEADER_GROUPS.reduce(
        (sum, group) => sum + (group.children?.length ?? 1),
        0,
    ) + 1;

/** Columns where lower is better (gradient inverted). */
const INVERT_FIELDS = new Set([
    ...FRACTION_FIELDS,
    ...DURATION_FIELDS,
]);

function formatCell(fieldId: string, value: unknown): string {
    if (typeof value !== "number" || Number.isNaN(value)) return "-";
    if (DURATION_FIELDS.has(fieldId)) return msToHuman(value);
    if (FRACTION_FIELDS.has(fieldId)) return formatPct(value, true);
    if (SCORE_FIELDS.has(fieldId)) return formatPct(value, true);
    if (PLAIN_FIELDS.has(fieldId)) return formatNumber(value);
    return formatPct(value);
}

export default function Leaderboards({
    onApplyConfig,
    onRunConfig,
}: LeaderboardsProps) {
    return (
        <ButtonDialog
            contentSx={{ p: 0 }}
            customButton={(handleOpen) => (
                <Tooltip title="Leaderboards">
                    <IconButton
                        aria-label="Open leaderboards"
                        onClick={handleOpen}
                        size="small"
                    >
                        <LeaderboardIcon fontSize="small" />
                    </IconButton>
                </Tooltip>
            )}
            maxWidth="xl"
            title="Leaderboards"
            titleLong="Backtest Leaderboards"
        >
            {(handleClose: () => void) => (
                <LeaderboardsContent
                    onApplyConfig={onApplyConfig}
                    onClose={handleClose}
                    onRunConfig={onRunConfig}
                />
            )}
        </ButtonDialog>
    );
}

/** Mounts only while the dialog is open — loads entries on open. */
function LeaderboardsContent({
    onApplyConfig,
    onClose,
    onRunConfig,
}: LeaderboardsContentProps) {
    const [entries, setEntries] = useState<BacktestLeaderboardEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [orderBy, setOrderBy] = useState("leaderboard.gainPct");
    const [order, setOrder] = useState<Order>("desc");

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const resp = await axios.get<{ entries: BacktestLeaderboardEntry[] }>(
                endpoints.dev.backtestPrecisionLeaderboards,
            );
            setEntries(resp.data.entries ?? []);
        } catch (e) {
            setError(
                axios.isAxiosError(e)
                    ? (e.response?.data?.error ?? e.message)
                    : "Failed to load leaderboards",
            );
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const remove = async (id: string) => {
        try {
            await axios.delete(endpoints.dev.backtestPrecisionLeaderboards, {
                data: { id },
            });
            await load();
        } catch {
            setError("Failed to delete the entry.");
        }
    };

    /** Copies the settings draft — pasteable into Settings > Backup > Restore. */
    const copyConfig = async (entry: BacktestLeaderboardEntry) => {
        const config = entry.backtestConfig as BacktestConfig;
        await navigator.clipboard.writeText(
            JSON.stringify(config?.settings ?? config, null, 2),
        );
    };

    /** Numeric range per leaf column so gradient shading is relative across rows. */
    const columnRanges = useMemo(() => {
        const leafIds = HEADER_GROUPS.flatMap(
            (group) => group.children?.map((child) => child.id) ?? [group.id],
        );
        const ranges = new Map<string, { min: number; max: number }>();
        for (const id of leafIds) {
            const values = entries
                .map((entry) => getNested(entry, id))
                .filter((v): v is number => typeof v === "number" && !Number.isNaN(v));
            ranges.set(id, {
                min: values.length ? Math.min(...values) : 0,
                max: values.length ? Math.max(...values) : 0,
            });
        }
        return ranges;
    }, [entries]);

    const sortedEntries = useMemo(() => {
        const rows = [...entries];
        rows.sort((a, b) => {
            const aVal = getNested(a, orderBy);
            const bVal = getNested(b, orderBy);
            if (aVal == null && bVal == null) return 0;
            if (aVal == null) return -1;
            if (bVal == null) return 1;
            const aNum = Number(aVal);
            const bNum = Number(bVal);
            const cmp =
                !Number.isNaN(aNum) && !Number.isNaN(bNum)
                    ? aNum - bNum
                    : String(aVal).localeCompare(String(bVal));
            return order === "asc" ? cmp : -cmp;
        });
        return rows;
    }, [entries, order, orderBy]);

    const handleSort = (id: string) => {
        const isAsc = orderBy === id && order === "asc";
        setOrder(isAsc ? "desc" : "asc");
        setOrderBy(id);
    };

    const renderCell = (entry: BacktestLeaderboardEntry, fieldId: string) => {
        const value = getNested(entry, fieldId);
        const range = columnRanges.get(fieldId);
        const numeric = typeof value === "number" ? value : undefined;
        const background = range
            ? getGradientColor(numeric, range.min, range.max, INVERT_FIELDS.has(fieldId))
            : "inherit";
        return (
            <TableCell key={fieldId} sx={{ backgroundColor: background }}>
                {fieldId === "label"
                    ? entry.label ??
                      ((entry.backtestConfig as BacktestConfig)?.name ||
                          (entry.backtestConfig as BacktestConfig)?.range ||
                          entry.id)
                    : fieldId === "t"
                      ? formatTime(entry.t)
                      : formatCell(fieldId, value)}
            </TableCell>
        );
    };

    const runEntry = (entry: BacktestLeaderboardEntry) => {
        if (!onRunConfig) return;
        onClose();
        void onRunConfig(entry.backtestConfig as BacktestConfig);
    };

    return (
        <>
            <Box
                sx={{
                    alignItems: "center",
                    display: "flex",
                    justifyContent: "space-between",
                    px: 1,
                }}
            >
                <Typography color="text.secondary" variant="caption">
                    Stored in storage/leaderboards/[hash].json · Copy config pastes into
                    Settings → Backup → Restore Config.
                </Typography>
                <Button disabled={loading} onClick={() => void load()} size="small">
                    {loading ? "Refreshing..." : "Refresh"}
                </Button>
            </Box>
            {error && (
                <Typography color="error" sx={{ px: 2, py: 1 }} variant="body2">
                    {error}
                </Typography>
            )}
            {loading && entries.length === 0 ? (
                <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
                    <CircularProgress size={28} />
                </Box>
            ) : (
                <TableContainer>
                        <Table
                            size="small"
                            sx={{
                                borderCollapse: "collapse",
                                "& td, & th": {
                                    borderBottom: "1px solid rgba(0,0,0,0.15)",
                                    borderRight: "1px solid rgba(0,0,0,0.15)",
                                    m: 0,
                                    p: 0.5,
                                    textAlign: "center",
                                    whiteSpace: "nowrap",
                                },
                            }}
                        >
                            <TableHead sx={{ backgroundColor: grey[300] }}>
                                <TableRow>
                                    {HEADER_GROUPS.map((group) =>
                                        group.children ? (
                                            <TableCell
                                                align="center"
                                                colSpan={group.children.length}
                                                key={group.id}
                                            >
                                                <Tooltip title={group.tooltip ?? ""}>
                                                    <Button color="inherit" size="small">
                                                        {group.label}
                                                    </Button>
                                                </Tooltip>
                                            </TableCell>
                                        ) : (
                                            <TableCell
                                                align={group.align ?? "left"}
                                                key={group.id}
                                                rowSpan={2}
                                            >
                                                <Tooltip title={group.tooltip ?? ""}>
                                                    <TableSortLabel
                                                        active={orderBy === group.id}
                                                        direction={
                                                            orderBy === group.id ? order : "asc"
                                                        }
                                                        onClick={() => handleSort(group.id)}
                                                    >
                                                        {group.label}
                                                    </TableSortLabel>
                                                </Tooltip>
                                            </TableCell>
                                        ),
                                    )}
                                    <TableCell align="center" rowSpan={2}>
                                        Actions
                                    </TableCell>
                                </TableRow>
                                <TableRow>
                                    {HEADER_GROUPS.flatMap((group) =>
                                        (group.children ?? []).map((child) => (
                                            <TableCell align="center" key={child.id}>
                                                <TableSortLabel
                                                    active={orderBy === child.id}
                                                    direction={
                                                        orderBy === child.id ? order : "asc"
                                                    }
                                                    onClick={() => handleSort(child.id)}
                                                >
                                                    {child.label}
                                                </TableSortLabel>
                                            </TableCell>
                                        )),
                                    )}
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {sortedEntries.map((entry) => (
                                    <TableRow key={entry.id}>
                                        {HEADER_GROUPS.flatMap((group) =>
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
                                                        onClick={() => void copyConfig(entry)}
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
                                                {onRunConfig && (
                                                    <Tooltip title="Load and run">
                                                        <IconButton
                                                            aria-label="Run config"
                                                            onClick={() => runEntry(entry)}
                                                            size="small"
                                                        >
                                                            <PlayArrowIcon fontSize="small" />
                                                        </IconButton>
                                                    </Tooltip>
                                                )}
                                                <Tooltip title="Delete entry">
                                                    <IconButton
                                                        aria-label="Delete entry"
                                                        onClick={() => void remove(entry.id)}
                                                        size="small"
                                                    >
                                                        <DeleteIcon fontSize="small" />
                                                    </IconButton>
                                                </Tooltip>
                                            </Box>
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {sortedEntries.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={TABLE_COLSPAN}>
                                            <Typography
                                                color="text.secondary"
                                                sx={{ py: 3 }}
                                                variant="body2"
                                            >
                                                No saved runs yet — run a backtest and choose
                                                Save to leaderboards.
                                            </Typography>
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </TableContainer>
            )}
        </>
    );
}
