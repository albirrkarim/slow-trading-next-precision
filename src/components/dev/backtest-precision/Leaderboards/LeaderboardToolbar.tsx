"use client";

import {
    Box,
    Button,
    MenuItem,
    Select,
    Typography,
} from "@mui/material";

import type {
    BacktestLeaderboardEntry,
    LeaderboardProfile,
} from "@/lib/dev/backtestPrecision/leaderboards";
import LeaderboardProfilesManager from "../LeaderboardProfilesManager";

import type { HeaderGroup } from "./columns";
import { ColumnVisibilityButton } from "./ColumnVisibilityButton";

export function LeaderboardToolbar(props: {
    activeProfileName: string;
    entries: BacktestLeaderboardEntry[];
    headerGroups: HeaderGroup[];
    hiddenColumns: ReadonlySet<string>;
    loading: boolean;
    onHiddenColumnsChange: (next: Set<string>) => void;
    onProfilesChanged: () => void;
    onRefresh: () => void;
    onSelectProfile: (name: string) => void;
    profiles: LeaderboardProfile[];
}) {
    const {
        activeProfileName,
        entries,
        headerGroups,
        hiddenColumns,
        loading,
        onHiddenColumnsChange,
        onProfilesChanged,
        onRefresh,
        onSelectProfile,
        profiles,
    } = props;

    return (
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
                        onSelectProfile(event.target.value);
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
                    onChanged={onProfilesChanged}
                    profiles={profiles}
                />
            </Box>
            <Box sx={{ alignItems: "center", display: "flex", gap: 0.5 }}>
                <ColumnVisibilityButton
                    headerGroups={headerGroups}
                    hiddenColumns={hiddenColumns}
                    onHiddenColumnsChange={onHiddenColumnsChange}
                />
                <Button disabled={loading} onClick={onRefresh} size="small">
                    {loading ? "Refreshing..." : "Refresh"}
                </Button>
            </Box>
        </Box>
    );
}
