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
import type { ReactElement } from "react";
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

function formatUsdt(value: number | undefined) {
    if (value == null || Number.isNaN(value)) return "-";
    return value < 0 ? `-$${Math.abs(value).toFixed(2)}` : `$${value.toFixed(2)}`;
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

const headerTooltipSlotProps = {
    tooltip: {
        sx: {
            fontSize: "0.8rem",
            lineHeight: 1.45,
            maxWidth: 420,
            p: 1.1,
            whiteSpace: "pre-line",
        },
    },
} as const;

function HeaderTooltip({
    children,
    title,
}: {
    children: ReactElement;
    title?: string;
}) {
    return (
        <Tooltip
            arrow
            placement="top"
            slotProps={headerTooltipSlotProps}
            title={title ?? ""}
        >
            {children}
        </Tooltip>
    );
}

interface HeaderGroup {
    id: string;
    label: string;
    align?: "left" | "right" | "center";
    children?: { id: string; label: string; tooltip?: string }[];
    tooltip?: string;
}

const HEADER_GROUPS: HeaderGroup[] = [
    {
        id: "label",
        label: "Label",
        tooltip: "Name of this saved run.\nFalls back to the backtest name or date range when no label was set.\nThe entry id is a content hash — re-saving the same config + range overwrites it.\nSource: entry.label → backtestConfig.name → range → id (storage/leaderboards/[hash].json).",
    },
    {
        id: "t",
        label: "Saved At",
        tooltip: "Local time the run was persisted via the \"Save run to leaderboards\" button.\nSource: entry.t on the saved file (storage/leaderboards/[hash].json).",
    },
    {
        id: "leaderboard.gainPct",
        label: "Gain",
        align: "right",
        tooltip: "Total realized return over the whole run.\n(final total − starting balance) / starting balance × 100%.\nStarting balance = sum of every account's initial balance.\nFinal total = last combined balance snapshot — open-position PnL is excluded.\nHigher is better.\nSource: backtest result → balanceSnapshots (each account's startingBalance + last timeline total), computed at save time.",
    },
    {
        id: "leaderboard.winRate",
        label: "Win Rate",
        align: "right",
        tooltip: "Closed positions that finished with net USDT profit > 0, as a percentage of all closed positions.\nStill-open positions are not counted.\nSource: backtest result → positions[].closed + pnl.netUsdt.",
    },
    {
        id: "leaderboard.positionsClosed",
        label: "Trades",
        align: "right",
        tooltip: "Number of closed positions over the backtest range, summed across all accounts.\nMore trades means more samples — but also more fees, so read it together with Gain and Monthly Gain.\nSource: backtest result → positions[] with a closed event.",
    },
    {
        id: "leaderboard.sharpeRatio",
        label: "Sharpe",
        align: "right",
        tooltip: "Sharpe ratio of month-over-month total-balance returns (UTC months).\nmean(monthly returns) / stddev(monthly returns) — not annualized.\n0 when fewer than 2 monthly returns exist in the range.\nHigher = smoother compounding.\nSource: backtest result → balanceSnapshots month-end combined totals.",
    },
    {
        id: "leaderboard.maxPortfolioDrawdown",
        label: "Portfolio DD",
        align: "center",
        tooltip: "Worst unrealized USDT dip each position ever reached, as a share of the portfolio.\n−pnl.maxDownUsdt / mean total balance, per position.\nUnlike Floating DD 'usd', each dip is normalized by portfolio size.\nLower is better — negative means a position never went underwater.\nSource: positions[].pnl.maxDownUsdt ÷ mean balanceSnapshots.total.",
        children: [
            {
                id: "leaderboard.maxPortfolioDrawdown.avg",
                label: "avg",
                tooltip: "Mean per-position worst dip as a share of the portfolio — the typical worst-case drag one trade put on total balance.\nSource: positions[].pnl.maxDownUsdt ÷ mean balanceSnapshots.total.",
            },
            {
                id: "leaderboard.maxPortfolioDrawdown.max",
                label: "max",
                tooltip: "Worst single trade — the deepest one position ever dragged the portfolio.\nSource: positions[].pnl.maxDownUsdt ÷ mean balanceSnapshots.total.",
            },
        ],
    },
    {
        id: "leaderboard.maxFloatingDrawdown",
        label: "Floating DD",
        align: "center",
        tooltip: "Deepest dip each position ever saw, shown in two units.\npct — −pnl.maxDownPct / 100: dip vs the position's own deployed notional.\nusd — −pnl.maxDownUsdt: raw USDT loss at its worst.\navg = mean across positions · max = worst single trade. Lower is better.\nSource: positions[].pnl.maxDownPct / maxDownUsdt — exact running extrema kept every monitoring pass (more accurate than the bucketed pnl.history).",
        children: [
            {
                id: "leaderboard.maxFloatingDrawdown.avg",
                label: "avg pct",
                tooltip: "Mean deepest dip across positions, as a share of each position's own notional — the typical worst-case per trade.\nSource: −positions[].pnl.maxDownPct / 100.",
            },
            {
                id: "leaderboard.maxFloatingDrawdown.max",
                label: "max pct",
                tooltip: "Worst single position — the deepest any trade dipped vs its own notional.\nSource: −positions[].pnl.maxDownPct / 100.",
            },
            {
                id: "leaderboard.maxFloatingDrawdownUsdt.avg",
                label: "avg usd",
                tooltip: "Mean worst USDT dip across positions — the typical worst-case loss per trade, un-normalized.\nSource: −positions[].pnl.maxDownUsdt.",
            },
            {
                id: "leaderboard.maxFloatingDrawdownUsdt.max",
                label: "max usd",
                tooltip: "Worst single trade — the most one position ever lost while open.\nSource: −positions[].pnl.maxDownUsdt.",
            },
        ],
    },
    {
        id: "leaderboard.bearMarketProofRatio",
        label: "Bear Proof",
        align: "right",
        tooltip: "Resilience inside detected bear windows.\nA bear window is a ≥20% peak→trough drawdown on a symbol's volatility-point price series.\nScore = 100 − mean portfolio floating drag inside those windows.\n100 = untouched by bear phases · 0 = no bear window found in the range.\nSource: vPointsMap price series per symbol (window detection) + balance/position timeline (drag inside windows).",
    },
    {
        id: "leaderboard.monthlyGain",
        label: "Monthly Gain",
        align: "center",
        tooltip: "Realized net profit per UTC month / month-start total balance × 100%.\nMonths covered by the balance timeline with no closed trades count as 0%.\nSource: positions[].closed.t + pnl.netUsdt grouped by UTC month, over month-start totals from balanceSnapshots.",
        children: [
            {
                id: "leaderboard.monthlyGain.min",
                label: "min",
                tooltip: "Worst calendar month — the floor of realized monthly performance.\nSource: same monthly series as Monthly Gain.",
            },
            {
                id: "leaderboard.monthlyGain.avg",
                label: "avg",
                tooltip: "Mean realized gain across all covered months — includes 0% months with no closed trades.\nSource: same monthly series as Monthly Gain.",
            },
            {
                id: "leaderboard.monthlyGain.max",
                label: "max",
                tooltip: "Best calendar month of the run.\nSource: same monthly series as Monthly Gain.",
            },
        ],
    },
    {
        id: "leaderboard.avgMonthlyProfitPct",
        label: "Avg Monthly",
        align: "right",
        tooltip: "Average realized monthly profit as a share of the STARTING balance.\nmean(monthly net USDT) / starting balance × 100%.\nA flat-rate view — unlike Monthly Gain it does not compound off the growing balance.\nSource: same monthly pnl.netUsdt series ÷ combined startingBalance from balanceSnapshots.",
    },
    {
        id: "leaderboard.balanceTradesScore",
        label: "Trades Bal",
        align: "right",
        tooltip: "How evenly closed trades are spread across symbols.\nexp(−CV) of per-symbol closed-trade counts.\n100% = perfectly even · lower = concentrated in a few coins.\nDefaults to 100% when no trades closed.\nSource: positions[] grouped by symbol (closed trades only).",
    },
    {
        id: "leaderboard.capitalEfficiency",
        label: "Capital Eff",
        align: "center",
        tooltip: "How hard the balance worked during the run.\nHR — held-ratio score: 1 − time-weighted locked/total. Higher = less capital stuck in open positions.\nTR — turnover score: daily locked-capital turnover normalized to average total balance, clamped to 100%. Higher = capital recycles faster.\nFinal — (HR + TR) / 2.\nSource: balanceSnapshots locked + total fields, time-weighted across the run.",
        children: [
            {
                id: "leaderboard.capitalEfficiency.hrScore",
                label: "HR",
                tooltip: "Held-ratio score: 1 − time-weighted (locked / total).\nHigher = less capital parked in open positions.\nSource: balanceSnapshots locked + total timeline.",
            },
            {
                id: "leaderboard.capitalEfficiency.trScore",
                label: "TR",
                tooltip: "Turnover score: daily locked-capital turnover ÷ average total balance, clamped to 100%.\nHigher = capital recycles faster.\nSource: balanceSnapshots — sum of |Δlocked| per day ÷ avg total.",
            },
            {
                id: "leaderboard.capitalEfficiency.score",
                label: "Final",
                tooltip: "Combined efficiency score: (HR + TR) / 2.\nHigher = balance stayed both free and active.\nSource: the HR and TR scores above.",
            },
        ],
    },
    {
        id: "leaderboard.emptyBalance",
        label: "Empty Balance",
        align: "center",
        tooltip: "How long the combined spendable balance stayed ≤ $2 — below the trading minimum — per consecutive dry spell.\nAll zeros = never ran dry: entries were never starved for quote.\nSource: balanceSnapshots spendable field vs the $2 trading minimum.",
        children: [
            {
                id: "leaderboard.emptyBalance.min",
                label: "min",
                tooltip: "Shortest dry spell — the smallest stretch without spendable balance.\nSource: same spendable timeline as Empty Balance.",
            },
            {
                id: "leaderboard.emptyBalance.avg",
                label: "avg",
                tooltip: "Mean dry-spell length.\nSource: same spendable timeline as Empty Balance.",
            },
            {
                id: "leaderboard.emptyBalance.max",
                label: "max",
                tooltip: "Longest dry spell — the worst stretch without spendable balance.\nSource: same spendable timeline as Empty Balance.",
            },
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

const USD_FIELDS = new Set([
    "leaderboard.maxFloatingDrawdownUsdt.avg",
    "leaderboard.maxFloatingDrawdownUsdt.max",
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
    ...USD_FIELDS,
]);

function formatCell(fieldId: string, value: unknown): string {
    if (typeof value !== "number" || Number.isNaN(value)) return "-";
    if (DURATION_FIELDS.has(fieldId)) return msToHuman(value);
    if (FRACTION_FIELDS.has(fieldId)) return formatPct(value, true);
    if (USD_FIELDS.has(fieldId)) return formatUsdt(value);
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
                                                    <TableSortLabel
                                                        active={orderBy === group.id}
                                                        direction={
                                                            orderBy === group.id ? order : "asc"
                                                        }
                                                        onClick={() => handleSort(group.id)}
                                                    >
                                                        {group.label}
                                                    </TableSortLabel>
                                                </HeaderTooltip>
                                            </TableCell>
                                        ),
                                    )}
                                    <TableCell align="center" rowSpan={2}>
                                        <HeaderTooltip title="Copy the run's settings JSON (paste into Settings → Backup → Restore), load it into the backtest form, re-run it, or delete the entry.">
                                            <span>Actions</span>
                                        </HeaderTooltip>
                                    </TableCell>
                                </TableRow>
                                <TableRow>
                                    {HEADER_GROUPS.flatMap((group) =>
                                        (group.children ?? []).map((child) => (
                                            <TableCell align="center" key={child.id}>
                                                <HeaderTooltip title={child.tooltip}>
                                                    <TableSortLabel
                                                        active={orderBy === child.id}
                                                        direction={
                                                            orderBy === child.id ? order : "asc"
                                                        }
                                                        onClick={() => handleSort(child.id)}
                                                    >
                                                        {child.label}
                                                    </TableSortLabel>
                                                </HeaderTooltip>
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
