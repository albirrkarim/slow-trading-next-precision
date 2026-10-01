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

const FILTER_STORAGE_KEY = "precision-backtest-trade-history-filters";

interface StoredTradeFilters {
  account?: string;
  exitLevel?: string;
  from?: string;
  to?: string;
}

/** Reads the last used filter values; `{}` when storage is unavailable. */
function readStoredFilters(): StoredTradeFilters {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(FILTER_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : undefined;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as StoredTradeFilters)
      : {};
  } catch {
    // Local storage can be unavailable in private or restricted contexts.
    return {};
  }
}

/** Persists the current filter values; removes the key once all are empty. */
function writeStoredFilters(filters: StoredTradeFilters): void {
  if (typeof window === "undefined") return;
  try {
    if (filters.account || filters.exitLevel || filters.from || filters.to) {
      window.localStorage.setItem(
        FILTER_STORAGE_KEY,
        JSON.stringify(filters),
      );
    } else {
      window.localStorage.removeItem(FILTER_STORAGE_KEY);
    }
  } catch {
    // Local storage can be unavailable in private or restricted contexts.
  }
}

export interface BacktestTradeFilters {
  /** Account slug; undefined matches every account. */
  account?: string;
  /**
   * Exclusive exit-level floor on `Math.abs(closed.vPoint.lvl)` — `3` keeps
   * trades that exited at level 4 or deeper on either side. Trades without
   * an exit vPoint never match a set bound.
   */
  exitLevelGt?: number;
  /** Inclusive entry-time lower bound; undefined matches from the start. */
  fromMs?: number;
  /** Inclusive entry-time upper bound; undefined matches to the end. */
  toMs?: number;
}

/**
 * Filters backtest trades by account slug, entry-time bounds, and exit
 * vPoint level. All set filters apply with AND semantics; unset filters
 * match everything.
 */
export function filterBacktestTradeHistory<
  T extends {
    account: string;
    closed?: { vPoint?: { lvl: number } };
    opened: { t: number };
  },
>(history: T[], filters: BacktestTradeFilters): T[] {
  const { account, exitLevelGt, fromMs, toMs } = filters;
  if (
    !account &&
    exitLevelGt === undefined &&
    fromMs === undefined &&
    toMs === undefined
  ) {
    return history;
  }
  return history.filter(
    (trade) =>
      (!account || trade.account === account) &&
      (fromMs === undefined || trade.opened.t >= fromMs) &&
      (toMs === undefined || trade.opened.t <= toMs) &&
      (exitLevelGt === undefined ||
        (trade.closed?.vPoint?.lvl !== undefined &&
          Math.abs(trade.closed.vPoint.lvl) > exitLevelGt)),
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

  // Trade filters AND-combined: account slug, entry-date bounds, exit level.
  // Values persist in localStorage so collapse/unmount and reloads keep them.
  const [storedFilters] = useState(readStoredFilters);
  const [filterAccount, setFilterAccount] = useState(
    storedFilters.account ?? "",
  );
  const [filterFromDate, setFilterFromDate] = useState(
    storedFilters.from ?? "",
  );
  const [filterToDate, setFilterToDate] = useState(storedFilters.to ?? "");
  const [filterExitLevel, setFilterExitLevel] = useState(
    storedFilters.exitLevel ?? "",
  );
  const hasFilters = Boolean(
    filterAccount || filterFromDate || filterToDate || filterExitLevel,
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
  const filterExitLevelN =
    filterExitLevel === "" || !Number.isFinite(Number(filterExitLevel))
      ? undefined
      : Number(filterExitLevel);
  const filteredTradeHistory = useMemo(
    () =>
      filterBacktestTradeHistory(tradeHistory, {
        account: effectiveFilterAccount || undefined,
        exitLevelGt: filterExitLevelN,
        fromMs: filterFromMs,
        toMs: filterToMs,
      }),
    [
      tradeHistory,
      effectiveFilterAccount,
      filterExitLevelN,
      filterFromMs,
      filterToMs,
    ],
  );
  useEffect(() => {
    writeStoredFilters({
      account: filterAccount,
      exitLevel: filterExitLevel,
      from: filterFromDate,
      to: filterToDate,
    });
  }, [filterAccount, filterExitLevel, filterFromDate, filterToDate]);

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
              label="Exit level >"
              size="small"
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ width: { xs: "100%", sm: 110 } }}
              type="number"
              value={filterExitLevel}
              onChange={(event) => setFilterExitLevel(event.target.value)}
            />
            {hasFilters && (
              <Button
                size="small"
                onClick={() => {
                  setFilterAccount("");
                  setFilterExitLevel("");
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
