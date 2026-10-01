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

import type { LazyArtifact } from "./use-backtest-artifacts";

export interface BacktestTradeFilters {
  /** Account slug; undefined matches every account. */
  account?: string;
  /** Inclusive entry-time lower bound; undefined matches from the start. */
  fromMs?: number;
  /** Inclusive entry-time upper bound; undefined matches to the end. */
  toMs?: number;
}

/**
 * Filters backtest trades by account slug and entry-time bounds. All set
 * filters apply with AND semantics; unset filters match everything.
 */
export function filterBacktestTradeHistory<
  T extends { account: string; opened: { t: number } },
>(history: T[], filters: BacktestTradeFilters): T[] {
  const { account, fromMs, toMs } = filters;
  if (!account && fromMs === undefined && toMs === undefined) {
    return history;
  }
  return history.filter(
    (trade) =>
      (!account || trade.account === account) &&
      (fromMs === undefined || trade.opened.t >= fromMs) &&
      (toMs === undefined || trade.opened.t <= toMs),
  );
}

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

  // Trade filters AND-combined: account slug plus entry-date bounds.
  const [filterAccount, setFilterAccount] = useState("");
  const [filterFromDate, setFilterFromDate] = useState("");
  const [filterToDate, setFilterToDate] = useState("");
  const hasFilters = Boolean(filterAccount || filterFromDate || filterToDate);
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
  const filteredTradeHistory = useMemo(
    () =>
      filterBacktestTradeHistory(tradeHistory, {
        account: effectiveFilterAccount || undefined,
        fromMs: filterFromMs,
        toMs: filterToMs,
      }),
    [tradeHistory, effectiveFilterAccount, filterFromMs, filterToMs],
  );
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
            {hasFilters && (
              <Button
                size="small"
                onClick={() => {
                  setFilterAccount("");
                  setFilterFromDate("");
                  setFilterToDate("");
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
