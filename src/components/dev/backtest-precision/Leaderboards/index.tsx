"use client";

import LeaderboardIcon from "@mui/icons-material/Leaderboard";
import {
    Box,
    CircularProgress,
    IconButton,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableRow,
    Tooltip,
    Typography,
} from "@mui/material";
import ButtonDialog from "@/components/ui/ButtonDialog";
import type { BacktestLeaderboardEntry } from "@/lib/dev/backtestPrecision/leaderboards";
import type { BacktestConfig } from "../types";

import { tableColspan } from "./columns";
import { LeaderboardRow } from "./LeaderboardRow";
import { LeaderboardTableHead } from "./LeaderboardTableHead";
import { LeaderboardToolbar } from "./LeaderboardToolbar";
import { TABLE_GRID_SX } from "./styles";
import { useLeaderboardData } from "./useLeaderboardData";

export { HEADER_GROUPS, tableColspan } from "./columns";
export type { HeaderGroup } from "./columns";
export { formatCell, TEXT_FIELDS } from "./fields";
export { formatMinEquity, formatTime } from "./format";
export { HeaderTooltip } from "./HeaderTooltip";
export { TABLE_GRID_SX, TABLE_HEAD_SX } from "./styles";

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
    const {
        activeProfileName,
        columnRanges,
        copyConfig,
        entries,
        error,
        handleSort,
        headerGroups,
        leafValue,
        load,
        loading,
        order,
        orderBy,
        profiles,
        remove,
        selectProfile,
        sortedEntries,
        toggleFavorite,
    } = useLeaderboardData();

    const runEntry = (entry: BacktestLeaderboardEntry) => {
        if (!onRunConfig) return;
        onClose();
        void onRunConfig(entry.backtestConfig as BacktestConfig);
    };

    return (
        <>
            <LeaderboardToolbar
                activeProfileName={activeProfileName}
                entries={entries}
                loading={loading}
                onProfilesChanged={() => void load()}
                onRefresh={() => void load()}
                onSelectProfile={selectProfile}
                profiles={profiles}
            />
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
                            <LeaderboardTableHead
                                headerGroups={headerGroups}
                                onSort={handleSort}
                                order={order}
                                orderBy={orderBy}
                            />
                            <TableBody>
                                {sortedEntries.map((entry) => (
                                    <LeaderboardRow
                                        columnRanges={columnRanges}
                                        entry={entry}
                                        headerGroups={headerGroups}
                                        key={entry.id}
                                        leafValue={leafValue}
                                        onApplyConfig={onApplyConfig}
                                        onCopyConfig={copyConfig}
                                        onRemove={remove}
                                        onRunEntry={onRunConfig ? runEntry : undefined}
                                        onToggleFavorite={toggleFavorite}
                                    />
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
