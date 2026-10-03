"use client";

import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteIcon from "@mui/icons-material/Delete";
import LeaderboardIcon from "@mui/icons-material/Leaderboard";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import StarIcon from "@mui/icons-material/Star";
import StarOutlineIcon from "@mui/icons-material/StarOutline";
import UploadIcon from "@mui/icons-material/Upload";
import {
    Box,
    Button,
    CircularProgress,
    IconButton,
    MenuItem,
    Select,
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
import axios from "axios";
import { useCallback, useEffect, useMemo, useState } from "react";
import ButtonDialog from "@/components/ui/ButtonDialog";
import { endpoints } from "../../../endpoints";
import type {
    BacktestLeaderboardEntry,
    LeaderboardProfile,
} from "@/lib/dev/backtestPrecision/leaderboards";
import {
    readLeaf,
    scoreEntries,
} from "@/lib/dev/backtestPrecision/leaderboards/leaves";
import LeaderboardProfilesManager from "../LeaderboardProfilesManager";
import type { BacktestConfig } from "../types";

import type { HeaderGroup } from "./columns";
import { HEADER_GROUPS, tableColspan } from "./columns";
import { formatCell, INVERT_FIELDS, TEXT_FIELDS } from "./fields";
import { formatMinEquity, formatNumber, formatTime, getGradientColor } from "./format";
import { HeaderTooltip } from "./HeaderTooltip";
import { PROFILE_STORAGE_KEY, readStoredProfileName } from "./profile-storage";
import { TABLE_GRID_SX, TABLE_HEAD_SX } from "./styles";

export { HEADER_GROUPS, tableColspan } from "./columns";
export type { HeaderGroup } from "./columns";
export { formatCell, TEXT_FIELDS } from "./fields";
export { formatMinEquity, formatTime } from "./format";
export { HeaderTooltip } from "./HeaderTooltip";
export { TABLE_GRID_SX, TABLE_HEAD_SX } from "./styles";

type Order = "asc" | "desc";

interface LeaderboardsProps {
    onApplyConfig?: (config: BacktestConfig) => void;
    onRunConfig?: (config: BacktestConfig) => void | Promise<void>;
}

interface LeaderboardsContentProps extends LeaderboardsProps {
    onClose: () => void;
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
            forceFullscreen
            maxWidth={false}
            title="Leaderboards"
            titleLong="Backtest Leaderboards"
            useAppBar
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
    const [profiles, setProfiles] = useState<LeaderboardProfile[]>([]);
    const [activeProfileName, setActiveProfileName] = useState(
        readStoredProfileName,
    );
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [orderBy, setOrderBy] = useState("leaderboard.gainPct");
    const [order, setOrder] = useState<Order>("desc");

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [entriesResp, profilesResp] = await Promise.all([
                axios.get<{ entries: BacktestLeaderboardEntry[] }>(
                    endpoints.dev.backtestPrecisionLeaderboards,
                ),
                axios.get<{ profiles: LeaderboardProfile[] }>(
                    endpoints.dev.backtestPrecisionLeaderboardProfiles,
                ),
            ]);
            setEntries(entriesResp.data.entries ?? []);
            const loadedProfiles = profilesResp.data.profiles ?? [];
            setProfiles(loadedProfiles);
            // A remembered profile sorts by its score once it exists.
            const remembered = readStoredProfileName();
            if (
                remembered &&
                loadedProfiles.some(
                    (candidate) => candidate.name === remembered,
                )
            ) {
                setOrderBy("profileScore");
                setOrder("desc");
            }
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

    /** Persists the favorite flag on the entry file, then patches the row. */
    const toggleFavorite = async (entry: BacktestLeaderboardEntry) => {
        try {
            const response = await axios.patch<{
                entry: BacktestLeaderboardEntry;
            }>(endpoints.dev.backtestPrecisionLeaderboards, {
                favorite: entry.favorite !== true,
                id: entry.id,
            });
            const updated = response.data.entry;
            setEntries((previous) =>
                previous.map((candidate) =>
                    candidate.id === updated.id ? updated : candidate,
                ),
            );
        } catch {
            setError("Failed to update the favorite flag.");
        }
    };

    /** Copies the settings draft — pasteable into Settings > Backup > Restore. */
    const copyConfig = async (entry: BacktestLeaderboardEntry) => {
        const config = entry.backtestConfig as BacktestConfig;
        await navigator.clipboard.writeText(
            JSON.stringify(config?.settings ?? config, null, 2),
        );
    };

    const profile = profiles.find(
        (candidate) => candidate.name === activeProfileName,
    );

    /** Per-entry composite scores for the selected profile (0-100). */
    const scores = useMemo(
        () => (profile ? scoreEntries(entries, profile.weights) : null),
        [entries, profile],
    );

    /** The Score column appears at the front only while a profile is active. */
    const headerGroups = useMemo<HeaderGroup[]>(
        () =>
            profile
                ? [
                      {
                          align: "right" as const,
                          id: "profileScore",
                          label: "Score",
                          tooltip: `Weighted composite for the "${profile.name}" profile.\nEach metric is min-max normalized across the listed entries after direction correction (lower-is-better flips), then weighted: Σ w·n / Σ|w| × 100.\nList-relative — the score shifts when entries are added or removed.\nWeights: ${Object.entries(profile.weights).map(([id, w]) => `${id.replace("leaderboard.", "")} ${w}`).join(" · ")}`,
                      },
                      ...HEADER_GROUPS,
                  ]
                : HEADER_GROUPS,
        [profile],
    );

    /** Leaf reader with the profile score pseudo-column overlaid. */
    const leafValue = useCallback(
        (entry: BacktestLeaderboardEntry, fieldId: string): unknown =>
            fieldId === "profileScore"
                ? scores?.get(entry.id)?.score
                : readLeaf(entry, fieldId),
        [scores],
    );

    /** Numeric range per leaf column so gradient shading is relative across rows. */
    const columnRanges = useMemo(() => {
        const leafIds = headerGroups.flatMap(
            (group) => group.children?.map((child) => child.id) ?? [group.id],
        );
        const ranges = new Map<string, { min: number; max: number }>();
        for (const id of leafIds) {
            const values = entries
                .map((entry) => leafValue(entry, id))
                .filter((v): v is number => typeof v === "number" && !Number.isNaN(v));
            ranges.set(id, {
                min: values.length ? Math.min(...values) : 0,
                max: values.length ? Math.max(...values) : 0,
            });
        }
        return ranges;
    }, [entries, headerGroups, leafValue]);

    const sortedEntries = useMemo(() => {
        const rows = [...entries];
        rows.sort((a, b) => {
            const aVal = leafValue(a, orderBy);
            const bVal = leafValue(b, orderBy);
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
    }, [entries, leafValue, order, orderBy]);

    const handleSort = (id: string) => {
        const isAsc = orderBy === id && order === "asc";
        setOrder(isAsc ? "desc" : "asc");
        setOrderBy(id);
    };

    const renderCell = (entry: BacktestLeaderboardEntry, fieldId: string) => {
        const value = leafValue(entry, fieldId);
        const range = columnRanges.get(fieldId);
        const numeric = typeof value === "number" ? value : undefined;
        const background = range
            ? getGradientColor(numeric, range.min, range.max, INVERT_FIELDS.has(fieldId))
            : "inherit";
        return (
            <TableCell key={fieldId} sx={{ backgroundColor: background }}>
                {fieldId === "profileScore"
                    ? formatNumber(numeric)
                    : fieldId === "minEquity"
                    ? formatMinEquity(entry)
                    : fieldId === "label"
                      ? entry.label ??
                      ((entry.backtestConfig as BacktestConfig)?.name ||
                          (entry.backtestConfig as BacktestConfig)?.range ||
                          entry.id)
                    : fieldId === "t"
                      ? formatTime(entry.t)
                      : TEXT_FIELDS.get(fieldId)?.(value) ??
                        formatCell(fieldId, value)}
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
                <Box sx={{ alignItems: "center", display: "flex", gap: 1 }}>
                    <Typography color="text.secondary" variant="caption">
                        Stored in storage/leaderboards/results/[hash].json · Copy config
                        pastes into Settings → Backup → Restore Config.
                    </Typography>
                    <Select
                        aria-label="Leaderboard profile"
                        displayEmpty
                        onChange={(event) => {
                            const name = event.target.value;
                            setActiveProfileName(name);
                            try {
                                localStorage.setItem(PROFILE_STORAGE_KEY, name);
                            } catch {
                                /* ignore */
                            }
                            setOrder(name ? "desc" : "desc");
                            setOrderBy(name ? "profileScore" : "leaderboard.gainPct");
                        }}
                        size="small"
                        sx={{ fontSize: "0.75rem", minWidth: 130 }}
                        value={
                            profiles.some(
                                (candidate) => candidate.name === activeProfileName,
                            )
                                ? activeProfileName
                                : ""
                        }
                    >
                        <MenuItem value="">
                            <em>No profile</em>
                        </MenuItem>
                        {profiles.map((candidate) => (
                            <MenuItem key={candidate.name} value={candidate.name}>
                                {candidate.name}
                            </MenuItem>
                        ))}
                    </Select>
                    <LeaderboardProfilesManager
                        entries={entries}
                        onChanged={() => void load()}
                        profiles={profiles}
                    />
                </Box>
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
                        <Table size="small" sx={TABLE_GRID_SX}
                        >
                            <TableHead sx={TABLE_HEAD_SX}>
                                <TableRow>
                                    <TableCell align="center" rowSpan={2}>
                                        <HeaderTooltip title="Favorite runs are marked with a filled star and stored on the entry file.">
                                            <span>
                                                <StarIcon fontSize="small" />
                                            </span>
                                        </HeaderTooltip>
                                    </TableCell>
                                    {headerGroups.map((group) =>
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
                                    {headerGroups.flatMap((group) =>
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
                                    <TableRow hover key={entry.id}>
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
                                                        void toggleFavorite(
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
                                        <TableCell colSpan={tableColspan(headerGroups)}>
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
