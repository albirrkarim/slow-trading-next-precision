"use client";

import axios from "axios";
import { useCallback, useEffect, useMemo, useState } from "react";

import { endpoints } from "../../../endpoints";
import type {
    BacktestLeaderboardEntry,
    LeaderboardProfile,
} from "@/lib/dev/backtestPrecision/leaderboards";
import {
    rangeDaysOf,
    readLeaf,
    scoreEntries,
} from "@/lib/dev/backtestPrecision/leaderboards/leaves";
import type { BacktestConfig } from "../types";

import {
    applyColumnVisibility,
    readHiddenColumns,
    writeHiddenColumns,
} from "./column-visibility";
import type { HeaderGroup } from "./columns";
import { HEADER_GROUPS } from "./columns";
import { PROFILE_STORAGE_KEY, readStoredProfileName } from "./profile-storage";

export type Order = "asc" | "desc";

export function useLeaderboardData() {
    const [entries, setEntries] = useState<BacktestLeaderboardEntry[]>([]);
    const [profiles, setProfiles] = useState<LeaderboardProfile[]>([]);
    const [activeProfileName, setActiveProfileName] = useState(
        readStoredProfileName,
    );
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [orderBy, setOrderBy] = useState("leaderboard.gainPct");
    const [order, setOrder] = useState<Order>("desc");
    const [hiddenColumns, setHiddenColumnsState] =
        useState<ReadonlySet<string>>(readHiddenColumns);

    /** Updates the hidden leaf columns and persists them to localStorage. */
    const setHiddenColumns = useCallback((next: Set<string>) => {
        setHiddenColumnsState(next);
        writeHiddenColumns(next);
    }, []);

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

    const selectProfile = (name: string) => {
        setActiveProfileName(name);
        try {
            localStorage.setItem(PROFILE_STORAGE_KEY, name);
        } catch {
            /* ignore */
        }
        setOrder(name ? "desc" : "desc");
        setOrderBy(name ? "profileScore" : "leaderboard.gainPct");
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

    /** Header groups filtered to the persisted visible columns. */
    const visibleHeaderGroups = useMemo(
        () => applyColumnVisibility(headerGroups, hiddenColumns),
        [headerGroups, hiddenColumns],
    );

    /** Leaf reader with the profile score pseudo-column overlaid. */
    const leafValue = useCallback(
        (entry: BacktestLeaderboardEntry, fieldId: string): unknown =>
            fieldId === "profileScore"
                ? scores?.get(entry.id)?.score
                : readLeaf(entry, fieldId),
        [scores],
    );

    /**
     * Numeric basis for the cell gradient. Text leaves get a numeric proxy:
     * the Range column shades by the run's duration in days.
     */
    const gradientValue = useCallback(
        (entry: BacktestLeaderboardEntry, fieldId: string): unknown =>
            fieldId === "backtestConfig.range"
                ? rangeDaysOf(entry.backtestConfig)
                : leafValue(entry, fieldId),
        [leafValue],
    );

    /** Numeric range per leaf column so gradient shading is relative across rows. */
    const columnRanges = useMemo(() => {
        const leafIds = headerGroups.flatMap(
            (group) => group.children?.map((child) => child.id) ?? [group.id],
        );
        const ranges = new Map<string, { min: number; max: number }>();
        for (const id of leafIds) {
            const values = entries
                .map((entry) => gradientValue(entry, id))
                .filter((v): v is number => typeof v === "number" && !Number.isNaN(v));
            ranges.set(id, {
                min: values.length ? Math.min(...values) : 0,
                max: values.length ? Math.max(...values) : 0,
            });
        }
        return ranges;
    }, [entries, gradientValue, headerGroups]);

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

    return {
        activeProfileName,
        columnRanges,
        copyConfig,
        entries,
        error,
        gradientValue,
        handleSort,
        headerGroups,
        hiddenColumns,
        leafValue,
        load,
        loading,
        order,
        orderBy,
        profiles,
        remove,
        selectProfile,
        setHiddenColumns,
        sortedEntries,
        toggleFavorite,
        visibleHeaderGroups,
    };
}
