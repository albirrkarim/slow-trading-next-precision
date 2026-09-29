"use client";

import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import TuneIcon from "@mui/icons-material/Tune";
import {
    Box,
    Button,
    Chip,
    Divider,
    IconButton,
    MenuItem,
    Select,
    TextField,
    Tooltip,
    Typography,
} from "@mui/material";
import axios from "axios";
import { Fragment, useMemo, useState } from "react";

import ButtonDialog from "@/components/ui/ButtonDialog";
import { endpoints } from "../../endpoints";
import type {
    BacktestLeaderboardEntry,
    LeaderboardProfile,
} from "@/lib/dev/backtestPrecision/leaderboards";
import {
    LOWER_IS_BETTER,
    PROFILE_METRICS,
    scoreEntries,
} from "@/lib/dev/backtestPrecision/leaderboards/leaves";
import type { BacktestConfig } from "./types";

interface WeightRow {
    id: string;
    weight: string;
}

const NEW_ROW: WeightRow = { id: PROFILE_METRICS[0].id, weight: "1" };

function rowsOf(profile: LeaderboardProfile | undefined): WeightRow[] {
    if (!profile) return [{ ...NEW_ROW }];
    return Object.entries(profile.weights).map(([id, weight]) => ({
        id,
        weight: String(weight),
    }));
}

function labelOf(entry: BacktestLeaderboardEntry): string {
    const config = entry.backtestConfig as BacktestConfig | undefined;
    return entry.label ?? config?.name ?? config?.range ?? entry.id;
}

function metricLabel(id: string): string {
    const metric = PROFILE_METRICS.find((candidate) => candidate.id === id);
    if (!metric) return id;
    return `${metric.label} ${LOWER_IS_BETTER.has(id) ? "↓" : "↑"}`;
}

/**
 * Profile CRUD dialog — each profile is a name plus weighted metric leaf ids
 * used to score and sort the leaderboard table and the MCP listing.
 */
export default function LeaderboardProfilesManager({
    entries,
    onChanged,
    profiles,
}: {
    entries: BacktestLeaderboardEntry[];
    onChanged: () => void;
    profiles: LeaderboardProfile[];
}) {
    return (
        <ButtonDialog
            contentSx={{
                display: "flex",
                flexDirection: "column",
                gap: 2.5,
                p: 2.5,
            }}
            customButton={(handleOpen) => (
                <Tooltip title="Manage weighted-metric profiles">
                    <IconButton
                        aria-label="Manage leaderboard profiles"
                        onClick={handleOpen}
                        size="small"
                    >
                        <TuneIcon fontSize="small" />
                    </IconButton>
                </Tooltip>
            )}
            maxWidth="md"
            title="Profiles"
            titleLong="Leaderboard Profiles"
        >
            {(handleClose: () => void) => (
                <ProfilesManagerContent
                    entries={entries}
                    onChanged={onChanged}
                    onClose={handleClose}
                    profiles={profiles}
                />
            )}
        </ButtonDialog>
    );
}

function ProfilesManagerContent({
    entries,
    onChanged,
    onClose,
    profiles,
}: {
    entries: BacktestLeaderboardEntry[];
    onChanged: () => void;
    onClose: () => void;
    profiles: LeaderboardProfile[];
}) {
    // Mounts fresh on each dialog open — safe to seed state from props.
    const [name, setName] = useState(profiles[0]?.name ?? "");
    const [rows, setRows] = useState<WeightRow[]>(() => rowsOf(profiles[0]));
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const editing = profiles.some(
        (profile) => profile.name.toLowerCase() === name.trim().toLowerCase(),
    );

    const weights = useMemo(() => {
        const draft: Record<string, number> = {};
        for (const row of rows) {
            const weight = Number(row.weight);
            if (row.id && Number.isFinite(weight)) draft[row.id] = weight;
        }
        return draft;
    }, [rows]);

    /** Live preview — how the current weights would rank the loaded board. */
    const preview = useMemo(() => {
        if (entries.length === 0 || Object.keys(weights).length === 0)
            return [];
        const scores = scoreEntries(entries, weights);
        return [...entries]
            .map((entry) => ({
                label: labelOf(entry),
                score: scores.get(entry.id)?.score ?? 0,
            }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 3);
    }, [entries, weights]);

    const startNew = () => {
        setName("");
        setRows([{ ...NEW_ROW }]);
        setError(null);
    };

    const save = async () => {
        setSaving(true);
        setError(null);
        try {
            await axios.post(endpoints.dev.backtestPrecisionLeaderboardProfiles, {
                name,
                weights,
            });
            onChanged();
        } catch (e) {
            setError(
                axios.isAxiosError(e)
                    ? (e.response?.data?.error ?? e.message)
                    : "Failed to save the profile.",
            );
        } finally {
            setSaving(false);
        }
    };

    const remove = async (profileName: string) => {
        setError(null);
        try {
            await axios.delete(
                endpoints.dev.backtestPrecisionLeaderboardProfiles,
                { data: { name: profileName } },
            );
            onChanged();
        } catch {
            setError("Failed to delete the profile.");
        }
    };

    return (
        <>
            <Typography color="text.secondary" variant="body2">
                Each metric is min-max normalized across the entries
                (lower-is-better metrics flip), then weighted — score = Σ w·n /
                Σ|w| × 100. Negative weights penalize a metric.
            </Typography>

            <Box
                sx={{
                    alignItems: "center",
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 1,
                }}
            >
                {profiles.map((profile) => (
                    <Chip
                        color={
                            profile.name.toLowerCase() ===
                            name.trim().toLowerCase()
                                ? "primary"
                                : "default"
                        }
                        deleteIcon={
                            <DeleteIcon
                                aria-label={`Delete profile ${profile.name}`}
                            />
                        }
                        key={profile.name}
                        label={profile.name}
                        onClick={() => {
                            setName(profile.name);
                            setRows(rowsOf(profile));
                            setError(null);
                        }}
                        onDelete={() => void remove(profile.name)}
                        sx={{ fontWeight: 600 }}
                        variant={
                            profile.name.toLowerCase() ===
                            name.trim().toLowerCase()
                                ? "filled"
                                : "outlined"
                        }
                    />
                ))}
                <Button
                    onClick={startNew}
                    size="small"
                    startIcon={<AddIcon />}
                    sx={{ textTransform: "none" }}
                >
                    New profile
                </Button>
            </Box>

            <Divider />

            <Box
                sx={{
                    alignItems: "center",
                    display: "grid",
                    gap: 1.5,
                    gridTemplateColumns: "minmax(0, 1fr) auto",
                }}
            >
                <TextField
                    inputProps={{ "aria-label": "Profile name" }}
                    label="Profile name"
                    onChange={(event) => setName(event.target.value)}
                    size="small"
                    value={name}
                />
                <Chip
                    color={editing ? "info" : "success"}
                    label={editing ? "Editing" : "New"}
                    variant="outlined"
                />
            </Box>

            <Box
                sx={{
                    alignItems: "center",
                    display: "grid",
                    gap: 1.5,
                    gridTemplateColumns: "minmax(0, 1fr) 110px 40px",
                }}
            >
                {rows.map((row, index) => (
                    <Fragment key={index}>
                        <Select
                            aria-label={`Metric ${index + 1}`}
                            onChange={(event) =>
                                setRows((current) =>
                                    current.map((entry, i) =>
                                        i === index
                                            ? { ...entry, id: event.target.value }
                                            : entry,
                                    ),
                                )
                            }
                            renderValue={(value) => metricLabel(value)}
                            size="small"
                            sx={{ fontSize: "0.85rem", minWidth: 0 }}
                            value={row.id}
                        >
                            {PROFILE_METRICS.map((metric) => {
                                const lower = LOWER_IS_BETTER.has(metric.id);
                                return (
                                    <MenuItem key={metric.id} value={metric.id}>
                                        <Box
                                            sx={{
                                                alignItems: "center",
                                                display: "flex",
                                                gap: 0.75,
                                            }}
                                        >
                                            {metric.label}
                                            <Typography
                                                color={
                                                    lower
                                                        ? "warning.main"
                                                        : "success.main"
                                                }
                                                component="span"
                                                sx={{ fontSize: "0.7rem" }}
                                            >
                                                {lower
                                                    ? "↓ lower is better"
                                                    : "↑ higher is better"}
                                            </Typography>
                                        </Box>
                                    </MenuItem>
                                );
                            })}
                        </Select>
                        <TextField
                            inputProps={{
                                "aria-label": `Weight ${index + 1}`,
                                step: 0.1,
                            }}
                            label="Weight"
                            onChange={(event) =>
                                setRows((current) =>
                                    current.map((entry, i) =>
                                        i === index
                                            ? {
                                                  ...entry,
                                                  weight: event.target.value,
                                              }
                                            : entry,
                                    ),
                                )
                            }
                            size="small"
                            type="number"
                            value={row.weight}
                        />
                        <IconButton
                            aria-label={`Remove metric ${index + 1}`}
                            onClick={() =>
                                setRows((current) =>
                                    current.filter((_, i) => i !== index),
                                )
                            }
                            size="small"
                        >
                            <DeleteIcon fontSize="small" />
                        </IconButton>
                    </Fragment>
                ))}
            </Box>

            <Button
                onClick={() =>
                    setRows((current) => [...current, { ...NEW_ROW }])
                }
                size="small"
                startIcon={<AddIcon />}
                sx={{ alignSelf: "flex-start" }}
            >
                Add metric
            </Button>

            {preview.length > 0 && (
                <Box
                    sx={{
                        backgroundColor: "action.hover",
                        borderRadius: 1,
                        p: 1.5,
                    }}
                >
                    <Typography
                        color="text.secondary"
                        sx={{ display: "block", mb: 0.75 }}
                        variant="caption"
                    >
                        Preview — top entries under these weights:
                    </Typography>
                    {preview.map((row, index) => (
                        <Box
                            key={index}
                            sx={{
                                alignItems: "center",
                                display: "flex",
                                justifyContent: "space-between",
                                py: 0.25,
                            }}
                        >
                            <Typography
                                noWrap
                                sx={{ fontSize: "0.8rem", maxWidth: "80%" }}
                            >
                                {row.label}
                            </Typography>
                            <Typography
                                sx={{ fontSize: "0.8rem", fontWeight: 700 }}
                            >
                                {row.score.toFixed(1)}
                            </Typography>
                        </Box>
                    ))}
                </Box>
            )}

            {error && (
                <Typography color="error" variant="body2">
                    {error}
                </Typography>
            )}

            <Box
                sx={{
                    display: "flex",
                    gap: 1,
                    justifyContent: "flex-end",
                    mt: 0.5,
                }}
            >
                <Button onClick={onClose}>Close</Button>
                <Button
                    disabled={
                        saving ||
                        name.trim() === "" ||
                        Object.keys(weights).length === 0
                    }
                    onClick={() => void save()}
                    variant="contained"
                >
                    Save profile
                </Button>
            </Box>
        </>
    );
}
