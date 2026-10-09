"use client";

import {
    Box,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TablePagination,
    TableRow,
    TableSortLabel,
    Typography,
} from "@mui/material";
import { useEffect, useMemo, useState } from "react";

import datasetFilters from "@/lib/dev/feature-gate/filters";
import type { FeatureGateDatasetOption, FeatureGateDatasetRow, FeatureGateInfo, FeatureGateRowQuery } from "@/lib/dev/feature-gate";
import type { FeatureGateResult } from "@/lib/strategies/feature-gates";

import DatasetFilters from "./DatasetFilters";
import DatasetRow from "./DatasetRow";
import filterStorage from "./filter-storage";

const PAGE_SIZES = [25, 50, 100];
type SortKey = "entry" | "missScore" | "sequence" | "time";

/** Stable row identity across sorting and filtering of one captured run. */
export function rowKey(row: FeatureGateDatasetRow): string {
    return JSON.stringify([row.symbol, row.t, row.sequences[0]?.id]);
}

/** Filters, sorts and paginates the already loaded run without another dataset request. */
export default function DatasetTable({
    cacheKey,
    rows,
    option,
    gates,
    slug,
    onSlugChange,
    decisions,
}: {
    cacheKey: string;
    rows: FeatureGateDatasetRow[];
    option?: FeatureGateDatasetOption;
    gates: FeatureGateInfo[];
    slug: string;
    onSlugChange: (slug: string) => void;
    decisions?: Map<string, FeatureGateResult>;
}) {
    const [page, setPage] = useState(0);
    const [pageSize, setPageSize] = useState(50);
    const [sort, setSort] = useState<SortKey>("time");
    const [order, setOrder] = useState<"asc" | "desc">("asc");
    const [filters, setFilters] = useState(() => filterStorage.read());

    useEffect(() => { filterStorage.write(filters); }, [filters]);

    const symbols = useMemo(() => [...new Set(rows.map((row) => row.symbol))].sort(), [rows]);
    const filtered = useMemo(() => {
        const query: FeatureGateRowQuery = {
            hash: cacheKey,
            symbol: filters.symbol || undefined,
            fromT: filters.from ? new Date(`${filters.from}T00:00:00`).getTime() : undefined,
            toT: filters.to ? new Date(`${filters.to}T23:59:59.999`).getTime() : undefined,
            ...(filters.value.trim() !== "" && Number.isFinite(Number(filters.value)) ? {
                metric: filters.metric,
                operator: filters.operator,
                value: Number(filters.value),
            } : {}),
        };
        const direction = order === "desc" ? -1 : 1;
        const sortValue = (row: FeatureGateDatasetRow): number => {
            if (sort === "sequence") return row.sequences.length;
            if (sort === "missScore") return row.missScore ?? (direction === 1 ? Infinity : -Infinity);
            if (sort === "entry") {
                const decision = decisions?.get(rowKey(row));
                return decision ? (decision.allow ? 1 : 0) : (direction === 1 ? Infinity : -Infinity);
            }
            return row.t ?? row.sequences[0]?.t ?? 0;
        };
        return rows.filter((row) => datasetFilters.matches(row, query))
            .sort((a, b) => (sortValue(a) - sortValue(b)) * direction);
    }, [cacheKey, rows, filters, sort, order, decisions]);
    const visible = filtered.slice(page * pageSize, (page + 1) * pageSize);

    const toggleSort = (key: SortKey) => {
        setPage(0);
        if (sort === key) setOrder(order === "asc" ? "desc" : "asc");
        else { setSort(key); setOrder("asc"); }
    };
    const sortableHeader = (key: SortKey, label: string) => (
        <TableSortLabel active={sort === key} direction={sort === key ? order : "asc"}
            onClick={() => toggleSort(key)}>{label}</TableSortLabel>
    );

    return (
        <Box>
            <DatasetFilters filters={filters} gates={gates} onChange={(next) => { setFilters(next); setPage(0); }}
                onSlugChange={onSlugChange} slug={slug} symbols={symbols} />
            <Typography color="text.secondary" variant="caption">
                {filtered.length !== rows.length
                    ? `${filtered.length.toLocaleString()} of ${rows.length.toLocaleString()} rows`
                    : `${rows.length.toLocaleString()} rows`}
            </Typography>
            <TableContainer>
                <Table aria-label="Dataset rows" size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell>{sortableHeader("time", "Time")}</TableCell>
                            <TableCell>Feature</TableCell>
                            <TableCell>{sortableHeader("sequence", "Level sequence")}</TableCell>
                            <TableCell align="right">{sortableHeader("missScore", "Miss score")}</TableCell>
                            <TableCell>{sortableHeader("entry", "Entry")}</TableCell>
                            <TableCell>Debug</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {visible.map((row) => {
                            const entry = decisions?.get(rowKey(row));
                            return <DatasetRow approvalMessage={entry?.allow && (row.missScore ?? -1) >= 3 ? entry.message : undefined}
                                entry={entry} evaluated={decisions !== undefined} hash={cacheKey}
                                key={rowKey(row)} option={option} row={row} />;
                        })}
                        {visible.length === 0 && <TableRow><TableCell colSpan={6}>
                            <Typography color="text.secondary" sx={{ py: 2 }} variant="body2">
                                No dataset rows match the filters.
                            </Typography>
                        </TableCell></TableRow>}
                    </TableBody>
                </Table>
            </TableContainer>
            <TablePagination component="div" count={filtered.length} page={page} rowsPerPage={pageSize}
                rowsPerPageOptions={PAGE_SIZES} onPageChange={(_, next) => setPage(next)}
                onRowsPerPageChange={(event) => { setPageSize(Number(event.target.value)); setPage(0); }} />
        </Box>
    );
}
