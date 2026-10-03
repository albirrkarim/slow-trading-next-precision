"use client";

import StarIcon from "@mui/icons-material/Star";
import {
    Button,
    TableCell,
    TableHead,
    TableRow,
    TableSortLabel,
} from "@mui/material";

import type { HeaderGroup } from "./columns";
import { HeaderTooltip } from "./HeaderTooltip";
import { TABLE_HEAD_SX } from "./styles";
import type { Order } from "./useLeaderboardData";

export function LeaderboardTableHead(props: {
    headerGroups: HeaderGroup[];
    onSort: (id: string) => void;
    order: Order;
    orderBy: string;
}) {
    const { headerGroups, onSort, order, orderBy } = props;

    return (
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
                                    onClick={() => onSort(group.id)}
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
                                    onClick={() => onSort(child.id)}
                                >
                                    {child.label}
                                </TableSortLabel>
                            </HeaderTooltip>
                        </TableCell>
                    )),
                )}
            </TableRow>
        </TableHead>
    );
}
