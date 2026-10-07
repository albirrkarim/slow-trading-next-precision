"use client";

import {
    Alert,
    Box,
    CircularProgress,
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
import axios from "axios";
import { useEffect, useState } from "react";

import { endpoints } from "@/components/endpoints";
import type { FeatureGateRowPage } from "@/lib/dev/feature-gate";

import DatasetFilters from "./DatasetFilters";
import DatasetRow from "./DatasetRow";
import filterStorage from "./filter-storage";

const PAGE_SIZES = [25, 50, 100];

/**
 * Server-paginated dataset table — every fetch addresses the run's
 * `dataset/*.json` through the dataset-rows endpoint; filters and pages
 * resolve server-side so the run size stays off the client.
 */
type SortKey = "missScore" | "sequence" | "time";

export default function DatasetTable({ cacheKey }: { cacheKey?: string }) {
    const [page, setPage] = useState(0);
    const [pageSize, setPageSize] = useState(50);
    const [sort, setSort] = useState<SortKey>("time");
    const [order, setOrder] = useState<"asc" | "desc">("asc");
    const [filters, setFilters] = useState(() => filterStorage.read());

    useEffect(() => {
        filterStorage.write(filters);
    }, [filters]);

    // The resolved page keyed by its query — a query change exposes empty
    // state for the new key until the fetch lands, so stale rows never
    // render under fresh filters and the effect needs no synchronous reset.
    const queryKey = JSON.stringify([
        cacheKey,
        page,
        pageSize,
        filters,
        sort,
        order,
    ]);
    const [entry, setEntry] = useState<
        { error?: string; key: string; value?: FeatureGateRowPage } | undefined
    >();
    const current = entry?.key === queryKey ? entry : undefined;
    const loading = cacheKey !== undefined && current === undefined;

    useEffect(() => {
        if (!cacheKey) return undefined;
        const controller = new AbortController();
        axios
            .get<FeatureGateRowPage>(endpoints.dev.featureGateDatasetRows, {
                params: {
                    hash: cacheKey,
                    ...(filters.value.trim() !== "" && Number.isFinite(Number(filters.value)) ? {
                        metric: filters.metric,
                        operator: filters.operator,
                        value: Number(filters.value),
                    } : {}),
                    fromT: filters.from ? new Date(`${filters.from}T00:00:00`).getTime() : undefined,
                    toT: filters.to ? new Date(`${filters.to}T23:59:59.999`).getTime() : undefined,
                    page: page + 1,
                    pageSize,
                    resolved: filters.resolvedOnly ? "true" : undefined,
                    order: order === "desc" ? "desc" : undefined,
                    sort: sort === "time" ? undefined : sort,
                    symbol: filters.symbol || undefined,
                },
                signal: controller.signal,
            })
            .then((resp) =>
                setEntry({ key: queryKey, value: resp.data }),
            )
            .catch((requestError) => {
                if (axios.isCancel(requestError)) return;
                setEntry({
                    error: axios.isAxiosError(requestError)
                        ? ((
                                requestError.response?.data as
                                    | { error?: string }
                                    | undefined
                            )?.error ?? requestError.message)
                        : "Failed to load dataset rows",
                    key: queryKey,
                });
            });
        return () => controller.abort();
    }, [cacheKey, filters, order, page, pageSize, queryKey, sort]);

    const toggleSort = (key: SortKey) => {
        setPage(0);
        if (sort === key) {
            setOrder(order === "asc" ? "desc" : "asc");
            return;
        }
        setSort(key);
        setOrder("asc");
    };

    const sortableHeader = (key: SortKey, label: string) => (
        <TableSortLabel
            active={sort === key}
            direction={sort === key ? order : "asc"}
            onClick={() => toggleSort(key)}
        >
            {label}
        </TableSortLabel>
    );

    const result = current?.value;
    const error = current?.error;

    if (!cacheKey) {
        return (
            <Typography color="text.secondary" variant="caption">
                Run a backtest to view its dataset.
            </Typography>
        );
    }

    return (
        <Box>
            <DatasetFilters
                filters={filters}
                onChange={(next) => { setFilters(next); setPage(0); }}
                symbols={entry?.value?.symbols ?? []}
            />
            {loading && <CircularProgress size={16} />}

            {error && <Alert severity="warning">{error}</Alert>}

            {result && (
                <>
                    <TableContainer>
                        <Table size="small">
                            <TableHead>
                                <TableRow>
                                    <TableCell>
                                        {sortableHeader("time", "Time")}
                                    </TableCell>
                                    <TableCell>Feature</TableCell>
                                    <TableCell>
                                        {sortableHeader(
                                            "sequence",
                                            "Level sequence",
                                        )}
                                    </TableCell>
                                    <TableCell align="right">
                                        {sortableHeader(
                                            "missScore",
                                            "Miss score",
                                        )}
                                    </TableCell>
                                    <TableCell>Debug</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {result.rows.map((row) => (
                                    <DatasetRow
                                        key={`${row.symbol}:${row.sequences[0]?.id}`}
                                        row={row}
                                    />
                                ))}
                                {result.rows.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={5}>
                                            <Typography
                                                color="text.secondary"
                                                sx={{ py: 2 }}
                                                variant="body2"
                                            >
                                                No dataset rows match the
                                                filters.
                                            </Typography>
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </TableContainer>
                    <TablePagination
                        component="div"
                        count={result.total}
                        onPageChange={(_, nextPage) => setPage(nextPage)}
                        onRowsPerPageChange={(event) => {
                            setPageSize(parseInt(event.target.value, 10));
                            setPage(0);
                        }}
                        page={page}
                        rowsPerPage={pageSize}
                        rowsPerPageOptions={PAGE_SIZES}
                    />
                </>
            )}
        </Box>
    );
}
