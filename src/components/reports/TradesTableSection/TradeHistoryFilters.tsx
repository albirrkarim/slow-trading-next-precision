"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
    Box,
    Button,
    MenuItem,
    TextField,
    Typography,
} from "@mui/material";

import {
    filterTradeHistory,
    readStoredFilters,
    TRADE_METRICS,
    TRADE_OPERATORS,
    writeStoredFilters,
} from "./trade-filters";
import type {
    FilterableTrade,
    TradeMetric,
    TradeOperator,
} from "./trade-filters";
import type { TradeHistoryAccount } from "./types";

/**
 * Trade-history filter bar — account picker, entry-date bounds, and one
 * composable `metric operator value` condition, AND-combined. Raw values
 * persist in localStorage under `storageKey` so reloads and remounts keep
 * them; children receive the filtered history via render prop.
 */
export function TradeHistoryFilters<T extends FilterableTrade>({
    accounts = [],
    children,
    history,
    storageKey,
}: {
    accounts?: TradeHistoryAccount[];
    children: (filtered: T[]) => ReactNode;
    history: T[];
    storageKey: string;
}) {
    const [storedFilters] = useState(() => readStoredFilters(storageKey));
    const [filterAccount, setFilterAccount] = useState(
        storedFilters.account ?? "",
    );
    const [filterFromDate, setFilterFromDate] = useState(
        storedFilters.from ?? "",
    );
    const [filterToDate, setFilterToDate] = useState(storedFilters.to ?? "");
    const [filterMetric, setFilterMetric] = useState<TradeMetric>(
        storedFilters.metric && storedFilters.metric in TRADE_METRICS
            ? (storedFilters.metric as TradeMetric)
            : "entryLevel",
    );
    const [filterOperator, setFilterOperator] = useState<TradeOperator>(
        storedFilters.operator && storedFilters.operator in TRADE_OPERATORS
            ? (storedFilters.operator as TradeOperator)
            : "lt",
    );
    const [filterValue, setFilterValue] = useState(storedFilters.value ?? "");
    const hasFilters = Boolean(
        filterAccount || filterFromDate || filterToDate || filterValue,
    );
    const effectiveFilterAccount = accounts.some(
        (account) => account.slug === filterAccount,
    )
        ? filterAccount
        : "";
    const filterFromMs = filterFromDate
        ? new Date(`${filterFromDate}T00:00:00`).getTime()
        : undefined;
    const filterToMs = filterToDate
        ? new Date(`${filterToDate}T23:59:59.999`).getTime()
        : undefined;
    const filterValueN =
        filterValue === "" || !Number.isFinite(Number(filterValue))
            ? undefined
            : Number(filterValue);
    const filteredHistory = useMemo(
        () =>
            filterTradeHistory(history, {
                account: effectiveFilterAccount || undefined,
                fromMs: filterFromMs,
                metric: filterMetric,
                operator: filterOperator,
                toMs: filterToMs,
                value: filterValueN,
            }),
        [
            history,
            effectiveFilterAccount,
            filterMetric,
            filterOperator,
            filterFromMs,
            filterToMs,
            filterValueN,
        ],
    );
    useEffect(() => {
        writeStoredFilters(storageKey, {
            account: filterAccount,
            from: filterFromDate,
            to: filterToDate,
            ...(filterValue !== ""
                ? {
                      metric: filterMetric,
                      operator: filterOperator,
                      value: filterValue,
                  }
                : {}),
        });
    }, [
        filterAccount,
        filterFromDate,
        filterMetric,
        filterOperator,
        filterToDate,
        filterValue,
        storageKey,
    ]);

    const tradeCountByAccount = useMemo(() => {
        const perAccount = new Map<string, number>();
        for (const trade of history) {
            perAccount.set(
                trade.account,
                (perAccount.get(trade.account) ?? 0) + 1,
            );
        }
        return perAccount;
    }, [history]);
    const accountOptions = useMemo(
        () =>
            accounts.map((account) => ({
                name: account.name?.trim() || account.slug,
                slug: account.slug,
            })),
        [accounts],
    );

    return (
        <Box>
            <Box
                sx={{
                    alignItems: { xs: "stretch", sm: "center" },
                    display: "flex",
                    flexDirection: { xs: "column", sm: "row" },
                    gap: 1,
                    justifyContent: "space-between",
                    mb: 1.5,
                }}
            >
                <Box
                    sx={{
                        alignItems: { xs: "stretch", sm: "center" },
                        display: "flex",
                        flexDirection: { xs: "column", sm: "row" },
                        flexWrap: "wrap",
                        gap: 1,
                    }}
                >
                    <TextField
                        label="Account"
                        select
                        size="small"
                        sx={{ minWidth: { xs: "100%", sm: 170 } }}
                        value={effectiveFilterAccount}
                        onChange={(event) =>
                            setFilterAccount(event.target.value)
                        }
                    >
                        <MenuItem value="">
                            All accounts ({history.length})
                        </MenuItem>
                        {accountOptions.map((account) => (
                            <MenuItem key={account.slug} value={account.slug}>
                                {`${account.name} (${
                                    tradeCountByAccount.get(account.slug) ?? 0
                                })`}
                            </MenuItem>
                        ))}
                    </TextField>
                    <TextField
                        label="Entry from"
                        size="small"
                        slotProps={{ inputLabel: { shrink: true } }}
                        sx={{ width: { xs: "100%", sm: 150 } }}
                        type="date"
                        value={filterFromDate}
                        onChange={(event) =>
                            setFilterFromDate(event.target.value)
                        }
                    />
                    <TextField
                        label="Entry to"
                        size="small"
                        slotProps={{ inputLabel: { shrink: true } }}
                        sx={{ width: { xs: "100%", sm: 150 } }}
                        type="date"
                        value={filterToDate}
                        onChange={(event) =>
                            setFilterToDate(event.target.value)
                        }
                    />
                    <TextField
                        label="Metric"
                        select
                        size="small"
                        sx={{ minWidth: { xs: "100%", sm: 130 } }}
                        value={filterMetric}
                        onChange={(event) =>
                            setFilterMetric(event.target.value as TradeMetric)
                        }
                    >
                        {Object.entries(TRADE_METRICS).map(([key, metric]) => (
                            <MenuItem key={key} value={key}>
                                {metric.label}
                            </MenuItem>
                        ))}
                    </TextField>
                    <TextField
                        label="Op"
                        select
                        size="small"
                        sx={{ width: { xs: "100%", sm: 80 } }}
                        value={filterOperator}
                        onChange={(event) =>
                            setFilterOperator(
                                event.target.value as TradeOperator,
                            )
                        }
                    >
                        {Object.entries(TRADE_OPERATORS).map(
                            ([key, operator]) => (
                                <MenuItem key={key} value={key}>
                                    {operator.label}
                                </MenuItem>
                            ),
                        )}
                    </TextField>
                    <TextField
                        label="Value"
                        size="small"
                        slotProps={{ inputLabel: { shrink: true } }}
                        sx={{ width: { xs: "100%", sm: 100 } }}
                        type="number"
                        value={filterValue}
                        onChange={(event) => setFilterValue(event.target.value)}
                    />
                    {hasFilters && (
                        <Button
                            size="small"
                            onClick={() => {
                                setFilterAccount("");
                                setFilterFromDate("");
                                setFilterToDate("");
                                setFilterMetric("entryLevel");
                                setFilterOperator("lt");
                                setFilterValue("");
                            }}
                        >
                            Clear
                        </Button>
                    )}
                </Box>
                {hasFilters && (
                    <Typography color="text.secondary" variant="body2">
                        Showing {filteredHistory.length} of {history.length}{" "}
                        trades
                    </Typography>
                )}
            </Box>
            {children(filteredHistory)}
        </Box>
    );
}
