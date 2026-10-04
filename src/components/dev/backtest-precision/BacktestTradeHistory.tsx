"use client";

import { useEffect, useMemo, useState } from "react";

import { TradesTableSection } from "@/components/reports/TradesTableSection";
import HeaderMetrics from "@/components/ui/HeaderMetrics";
import type { Position } from "@/lib/system/trading";
import type { ExchangeType, VolatilityPoint } from "@/lib/system/types";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";

import {
  filterBacktestTradeHistory,
  readStoredFilters,
  TRADE_METRICS,
  TRADE_OPERATORS,
  writeStoredFilters,
} from "./trade-filters";
import type {
  BacktestTradeMetric,
  BacktestTradeOperator,
} from "./trade-filters";
import type { LazyArtifact } from "./use-backtest-artifacts";

export default function BacktestTradeHistory({
  accounts,
  closedCount,
  exchangeType,
  positions,
  vpoints,
}: {
  accounts?: Array<{ name?: string; slug: string }>;
  /** Fallback count shown in the header while positions are still loading. */
  closedCount: number;
  exchangeType: ExchangeType;
  positions: LazyArtifact<Position[]>;
  vpoints: LazyArtifact<Record<string, VolatilityPoint[]>>;
}) {
  const tradeHistory = useMemo(
    () =>
      (positions.data ?? [])
        .filter((position) => position.closed)
        .map((position) => ({ ...position, mode: "sandbox" as const })),
    [positions.data],
  );

  return (
    <HeaderMetrics
      defaultExpanded={false}
      headerCanBeClicked
      rememberExpand="precision-backtest-trade-history"
      title={
        <Typography fontWeight={700} variant="body1">
          Trade History (
          {positions.data ? tradeHistory.length : closedCount})
        </Typography>
      }
    >
      {(expanded) =>
        expanded && (
          <TradeHistoryBody
            accounts={accounts}
            exchangeType={exchangeType}
            positions={positions}
            tradeHistory={tradeHistory}
            vpoints={vpoints}
          />
        )
      }
    </HeaderMetrics>
  );
}

/** Body — mounts only while expanded, so the positions artifact stays lazy. */
function TradeHistoryBody({
  accounts,
  exchangeType,
  positions,
  tradeHistory,
  vpoints,
}: {
  accounts?: Array<{ name?: string; slug: string }>;
  exchangeType: ExchangeType;
  positions: LazyArtifact<Position[]>;
  tradeHistory: Array<Position & { mode: "sandbox" }>;
  vpoints: LazyArtifact<Record<string, VolatilityPoint[]>>;
}) {
  const { ensure } = positions;
  useEffect(() => {
    void ensure();
  }, [ensure]);

  // Trade filters AND-combined: account slug, entry-date bounds, and one
  // composable `metric operator value` condition. Values persist in
  // localStorage so collapse/unmount and reloads keep them.
  const [storedFilters] = useState(readStoredFilters);
  const [filterAccount, setFilterAccount] = useState(
    storedFilters.account ?? "",
  );
  const [filterFromDate, setFilterFromDate] = useState(
    storedFilters.from ?? "",
  );
  const [filterToDate, setFilterToDate] = useState(storedFilters.to ?? "");
  const [filterMetric, setFilterMetric] = useState<BacktestTradeMetric>(
    storedFilters.metric &&
      storedFilters.metric in TRADE_METRICS
      ? (storedFilters.metric as BacktestTradeMetric)
      : "entryLevel",
  );
  const [filterOperator, setFilterOperator] =
    useState<BacktestTradeOperator>(
      storedFilters.operator &&
        storedFilters.operator in TRADE_OPERATORS
        ? (storedFilters.operator as BacktestTradeOperator)
        : "lt",
    );
  const [filterValue, setFilterValue] = useState(storedFilters.value ?? "");
  const hasFilters = Boolean(
    filterAccount || filterFromDate || filterToDate || filterValue,
  );
  const effectiveFilterAccount = (accounts ?? []).some(
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
  const filteredTradeHistory = useMemo(
    () =>
      filterBacktestTradeHistory(tradeHistory, {
        account: effectiveFilterAccount || undefined,
        fromMs: filterFromMs,
        metric: filterMetric,
        operator: filterOperator,
        toMs: filterToMs,
        value: filterValueN,
      }),
    [
      tradeHistory,
      effectiveFilterAccount,
      filterMetric,
      filterOperator,
      filterFromMs,
      filterToMs,
      filterValueN,
    ],
  );
  useEffect(() => {
    writeStoredFilters({
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
  ]);

  const tradeCountByAccount = useMemo(() => {
    const perAccount = new Map<string, number>();
    for (const trade of tradeHistory) {
      perAccount.set(trade.account, (perAccount.get(trade.account) ?? 0) + 1);
    }
    return perAccount;
  }, [tradeHistory]);
  const tableAccounts = useMemo(
    () =>
      (accounts ?? []).map((account) => ({
        name: account.name?.trim() || account.slug,
        slug: account.slug,
      })),
    [accounts],
  );

  return (
    <Box>
      {positions.data && (
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
              onChange={(event) => setFilterAccount(event.target.value)}
            >
              <MenuItem value="">All accounts ({tradeHistory.length})</MenuItem>
              {tableAccounts.map((account) => (
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
              onChange={(event) => setFilterFromDate(event.target.value)}
            />
            <TextField
              label="Entry to"
              size="small"
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ width: { xs: "100%", sm: 150 } }}
              type="date"
              value={filterToDate}
              onChange={(event) => setFilterToDate(event.target.value)}
            />
            <TextField
              label="Metric"
              select
              size="small"
              sx={{ minWidth: { xs: "100%", sm: 130 } }}
              value={filterMetric}
              onChange={(event) =>
                setFilterMetric(event.target.value as BacktestTradeMetric)
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
                  event.target.value as BacktestTradeOperator,
                )
              }
            >
              {Object.entries(TRADE_OPERATORS).map(([key, operator]) => (
                <MenuItem key={key} value={key}>
                  {operator.label}
                </MenuItem>
              ))}
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
              Showing {filteredTradeHistory.length} of {tradeHistory.length}{" "}
              trades
            </Typography>
          )}
        </Box>
      )}
      {positions.error && (
        <Alert severity="error" sx={{ mb: 1 }}>
          {positions.error}
        </Alert>
      )}
      {!positions.data && !positions.error && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
          <CircularProgress size={24} />
        </Box>
      )}
      {positions.data && (
        <TradesTableSection
          accounts={tableAccounts}
          exchangeType={exchangeType}
          getVolatilityPoints={(symbol) =>
            vpoints.data?.[symbol.toUpperCase().replace(/_USDT$/, "")] ?? []
          }
          history={filteredTradeHistory}
          mode="sandbox"
          onHistoryChange={() => undefined}
          readOnly
        />
      )}
    </Box>
  );
}
