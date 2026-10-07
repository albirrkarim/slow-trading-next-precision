"use client";

import {
    Alert,
    Box,
    Checkbox,
    CircularProgress,
    FormControl,
    FormControlLabel,
    InputLabel,
    MenuItem,
    Select,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TablePagination,
    TableRow,
    Typography,
} from "@mui/material";
import axios from "axios";
import { useEffect, useState } from "react";

import { endpoints } from "@/components/endpoints";
import type { FeatureGateRowPage } from "@/lib/dev/feature-gate";

import DatasetRow from "./DatasetRow";

const PAGE_SIZES = [25, 50, 100];

/**
 * Server-paginated dataset table — every fetch addresses the run's
 * `dataset/*.json` through the dataset-rows endpoint; filters and pages
 * resolve server-side so the run size stays off the client.
 */
export default function DatasetTable({ cacheKey }: { cacheKey?: string }) {
    const [page, setPage] = useState(0);
    const [pageSize, setPageSize] = useState(50);
    const [symbol, setSymbol] = useState("");
    const [resolvedOnly, setResolvedOnly] = useState(false);
    const [minMissScore, setMinMissScore] = useState<number | "">("");

    // The resolved page keyed by its query — a query change exposes empty
    // state for the new key until the fetch lands, so stale rows never
    // render under fresh filters and the effect needs no synchronous reset.
    const queryKey = `${cacheKey ?? ""}|${page}|${pageSize}|${symbol}|${resolvedOnly}|${minMissScore}`;
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
                    minMissScore:
                        minMissScore === "" ? undefined : minMissScore,
                    page: page + 1,
                    pageSize,
                    resolved: resolvedOnly ? "true" : undefined,
                    symbol: symbol || undefined,
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
    }, [cacheKey, page, pageSize, symbol, resolvedOnly, minMissScore, queryKey]);

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
            <Box
                sx={{
                    alignItems: "center",
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 1,
                    mb: 0.5,
                }}
            >
                <FormControl size="small" sx={{ minWidth: 120 }}>
                    <InputLabel>Symbol</InputLabel>
                    <Select
                        label="Symbol"
                        onChange={(e) => {
                            setSymbol(e.target.value);
                            setPage(0);
                        }}
                        size="small"
                        value={symbol}
                    >
                        <MenuItem value="">All</MenuItem>
                        {(result?.symbols ?? []).map((name) => (
                            <MenuItem key={name} value={name}>
                                {name}
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>

                <FormControlLabel
                    control={
                        <Checkbox
                            checked={resolvedOnly}
                            onChange={(e) => {
                                setResolvedOnly(e.target.checked);
                                setPage(0);
                            }}
                            size="small"
                        />
                    }
                    label="Resolved only"
                />

                <FormControl size="small" sx={{ minWidth: 140 }}>
                    <InputLabel>Min miss score</InputLabel>
                    <Select
                        label="Min miss score"
                        onChange={(e) => {
                            const value = String(e.target.value);
                            setMinMissScore(value === "" ? "" : Number(value));
                            setPage(0);
                        }}
                        size="small"
                        value={minMissScore}
                    >
                        <MenuItem value="">Any</MenuItem>
                        {[0, 1, 2, 3].map((score) => (
                            <MenuItem key={score} value={score}>
                                ≥ {score}
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>

                {loading && <CircularProgress size={16} />}
            </Box>

            {error && <Alert severity="warning">{error}</Alert>}

            {result && (
                <>
                    <TableContainer>
                        <Table size="small">
                            <TableHead>
                                <TableRow>
                                    <TableCell>Time</TableCell>
                                    <TableCell>Feature</TableCell>
                                    <TableCell>Level sequence</TableCell>
                                    <TableCell align="right">
                                        Miss score
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
