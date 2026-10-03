"use client";

import { endpoints } from "@/components/endpoints";
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
import axios from "axios";
import { useMemo, useState } from "react";
import { useSnackbar } from "notistack";
import format from "@/lib/system/utils/format";
import type { ExchangeType } from "@/lib/exchange";

import type { SlowTradingReportRow } from "../types";
import type { RuntimeMode } from "@/lib/system/runtime";
import type { RuntimeDashboardState } from "@/lib/system/dashboard";
import type { VolatilityPoint } from "@/lib/system/types";

import type { SortKey, TradeHistoryAccount } from "./types";
import { getEntryMarginUsdt } from "./format";
import { TradeAuditMessage } from "./cells";
import { TradeTableRow } from "./TradeTableRow";

export { TradeAuditMessage };

export function TradesTableSection({
  accounts = [],
  exchangeType,
  getVolatilityPoints,
  history,
  mode,
  onHistoryChange,
  readOnly = false,
}: {
  accounts?: TradeHistoryAccount[];
  exchangeType: ExchangeType;
  getVolatilityPoints?: (symbol: string) => VolatilityPoint[] | undefined;
  history: SlowTradingReportRow[];
  mode: RuntimeMode;
  onHistoryChange: (
    nextHistory: RuntimeDashboardState["history"],
    refreshDashboard?: boolean,
  ) => void;
  readOnly?: boolean;
}) {
  const { enqueueSnackbar } = useSnackbar();
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [sortKey, setSortKey] = useState<SortKey>("exitTime");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const accountBySlug = useMemo(
    () => new Map(accounts.map((account) => [account.slug, account])),
    [accounts],
  );

  const safePage = useMemo(() => {
    const maxPage = Math.max(0, Math.ceil(history.length / rowsPerPage) - 1);
    return Math.min(page, maxPage);
  }, [history.length, page, rowsPerPage]);

  const sortedHistory = useMemo(() => {
    const dir = sortDirection === "asc" ? 1 : -1;
    const getSortValue = (row: SlowTradingReportRow): string | number => {
      switch (sortKey) {
        case "symbol":
          return `${row.symbol ?? ""}`.toLowerCase();
        case "entryTime":
          return row.opened.t ?? 0;
        case "entryMarginUSDT":
          return getEntryMarginUsdt(row);
        case "exitTime":
          return row.closed?.t ?? 0;
        case "holdMs":
          return (row.closed?.t ?? 0) - row.opened.t;
        case "maxDrawdownPercent":
          return row.pnl.maxDownPct ?? 0;
        case "maxRunUpPercent":
          return row.pnl.maxUpPct ?? 0;
        case "maxDrawdownUsdt":
          return row.pnl.maxDownUsdt ?? 0;
        case "maxRunUpUsdt":
          return row.pnl.maxUpUsdt ?? 0;
        case "netProfitUSDT":
          return row.pnl.netUsdt ?? 0;
        default:
          return 0;
      }
    };

    return [...history]
      .map((row, index) => ({ row, index }))
      .sort((a, b) => {
        const av = getSortValue(a.row);
        const bv = getSortValue(b.row);
        if (typeof av === "number" && typeof bv === "number") {
          const diff = av - bv;
          if (diff !== 0) return diff * dir;
          return a.index - b.index;
        }
        const cmp = String(av).localeCompare(String(bv));
        if (cmp !== 0) return cmp * dir;
        return a.index - b.index;
      })
      .map((item) => item.row);
  }, [history, sortDirection, sortKey]);

  const pagedHistory = useMemo(() => {
    const start = safePage * rowsPerPage;
    return sortedHistory.slice(start, start + rowsPerPage);
  }, [rowsPerPage, safePage, sortedHistory]);

  const handleRequestSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection("desc");
    }
    setPage(0);
  };

  const buildRowKey = (row: SlowTradingReportRow, index: number) =>
    `${row.symbol}-${row.opened.t}-${row.closed?.t}-${index}`;

  const handleDeleteRow = async (row: SlowTradingReportRow, rowKey: string) => {
    if (readOnly) return;

    if (
      !confirm(
        `Delete trade history for ${row.symbol} entered at ${row.opened.t ? format.timeForLog(row.opened.t) : "unknown time"}?`,
      )
    ) {
      return;
    }

    setDeletingKey(rowKey);
    try {
      const response = await axios.delete<{
        state?: RuntimeDashboardState;
      }>(endpoints.system.history, {
        data: {
          account: row.account,
          mode,
          symbol: row.symbol,
          entryId: row.opened.vPoint.id,
          entryTime: row.opened.t,
          exitTime: row.closed?.t,
          quantity: row.exposure.quantity,
          usdt: row.exposure.notionalUsdt,
        },
      });

      onHistoryChange(response.data.state?.history ?? [], true);
      enqueueSnackbar(`Deleted trade history for ${row.symbol}`, {
        variant: "success",
      });
    } catch (error: any) {
      enqueueSnackbar(
        `Failed to delete ${row.symbol}: ${error.response?.data?.error || error.message}`,
        { variant: "error" },
      );
    } finally {
      setDeletingKey(null);
    }
  };

  return (
    <Box>
      <TableContainer>
        <Table
          stickyHeader
          size="small"
          sx={{
            "& .MuiTableBody-root .MuiTableCell-root": {
              verticalAlign: "top",
            },
          }}
        >
          <TableHead>
            <TableRow>
              <TableCell width={160}>
                <TableSortLabel
                  active={sortKey === "symbol"}
                  direction={sortKey === "symbol" ? sortDirection : "asc"}
                  onClick={() => handleRequestSort("symbol")}
                >
                  Symbol
                </TableSortLabel>
              </TableCell>
              <TableCell width={220}>PNL History</TableCell>
              <TableCell>
                <TableSortLabel
                  active={sortKey === "entryTime"}
                  direction={sortKey === "entryTime" ? sortDirection : "asc"}
                  onClick={() => handleRequestSort("entryTime")}
                >
                  Entry
                </TableSortLabel>
              </TableCell>
              <TableCell width={130} align="right">
                <TableSortLabel
                  active={sortKey === "entryMarginUSDT"}
                  direction={
                    sortKey === "entryMarginUSDT" ? sortDirection : "asc"
                  }
                  onClick={() => handleRequestSort("entryMarginUSDT")}
                >
                  Margin Entry
                </TableSortLabel>
              </TableCell>
              <TableCell>
                <TableSortLabel
                  active={sortKey === "exitTime"}
                  direction={sortKey === "exitTime" ? sortDirection : "asc"}
                  onClick={() => handleRequestSort("exitTime")}
                >
                  Exit
                </TableSortLabel>
              </TableCell>
              <TableCell width={110}>
                <TableSortLabel
                  active={sortKey === "holdMs"}
                  direction={sortKey === "holdMs" ? sortDirection : "asc"}
                  onClick={() => handleRequestSort("holdMs")}
                >
                  Hold
                </TableSortLabel>
              </TableCell>
              <TableCell width={110} align="center">
                <TableSortLabel
                  active={sortKey === "maxRunUpPercent"}
                  direction={
                    sortKey === "maxRunUpPercent" ? sortDirection : "asc"
                  }
                  onClick={() => handleRequestSort("maxRunUpPercent")}
                >
                  Max Up
                </TableSortLabel>
              </TableCell>
              <TableCell width={110} align="center">
                <TableSortLabel
                  active={sortKey === "maxDrawdownPercent"}
                  direction={
                    sortKey === "maxDrawdownPercent" ? sortDirection : "asc"
                  }
                  onClick={() => handleRequestSort("maxDrawdownPercent")}
                >
                  Max Down
                </TableSortLabel>
              </TableCell>
              <TableCell width={125} align="right">
                <TableSortLabel
                  active={sortKey === "maxRunUpUsdt"}
                  direction={
                    sortKey === "maxRunUpUsdt" ? sortDirection : "asc"
                  }
                  onClick={() => handleRequestSort("maxRunUpUsdt")}
                >
                  Max Up USD
                </TableSortLabel>
              </TableCell>
              <TableCell width={135} align="right">
                <TableSortLabel
                  active={sortKey === "maxDrawdownUsdt"}
                  direction={
                    sortKey === "maxDrawdownUsdt" ? sortDirection : "asc"
                  }
                  onClick={() => handleRequestSort("maxDrawdownUsdt")}
                >
                  Max Down USD
                </TableSortLabel>
              </TableCell>
              <TableCell width={120} align="right">
                <TableSortLabel
                  active={sortKey === "netProfitUSDT"}
                  direction={
                    sortKey === "netProfitUSDT" ? sortDirection : "asc"
                  }
                  onClick={() => handleRequestSort("netProfitUSDT")}
                >
                  PnL Final
                </TableSortLabel>
              </TableCell>
              <TableCell align="right">Detail</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {pagedHistory.map((row, index) => {
              const rowKey = buildRowKey(row, index);
              return (
                <TradeTableRow
                  accountBySlug={accountBySlug}
                  deletingKey={deletingKey}
                  exchangeType={exchangeType}
                  getVolatilityPoints={getVolatilityPoints}
                  history={history}
                  key={rowKey}
                  mode={mode}
                  onDeleteRow={handleDeleteRow}
                  onHistoryChange={onHistoryChange}
                  readOnly={readOnly}
                  row={row}
                  rowKey={rowKey}
                />
              );
            })}

            {history.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} align="center">
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ py: 4 }}
                  >
                    No slow-trading history available yet.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </TableContainer>

      <TablePagination
        component="div"
        count={history.length}
        page={safePage}
        onPageChange={(_, nextPage) => setPage(nextPage)}
        rowsPerPage={rowsPerPage}
        onRowsPerPageChange={(event) => {
          setRowsPerPage(parseInt(event.target.value, 10));
          setPage(0);
        }}
        rowsPerPageOptions={[10, 25, 50, 100]}
      />
    </Box>
  );
}
