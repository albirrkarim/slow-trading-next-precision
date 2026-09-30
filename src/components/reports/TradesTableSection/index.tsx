"use client";

import ButtonDialog from "@/components/ui/ButtonDialog";
import { endpoints } from "@/components/endpoints";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import {
  Box,
  Chip,
  IconButton,
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
import { NetProfitPercentHistorySparkline } from "@/components/charts/NetProfitPercentHistorySparkline";
import PositionLevelSequence, {
  buildHistoryPositionLevelSequence,
} from "@/components/charts/PositionLevelSequence";
import { EXCHANGE_COLOR_MAP } from "@/components/charts/constants";
import type { ExchangeType } from "@/lib/exchange";

import RangedValueText from "../RangedValueText";
import type { SlowTradingReportRow } from "../types";
import { formatHoldMs } from "../utils";
import { positionData } from "@/lib/system/trading";
import pair from "@/lib/strategies/shared/pair";
import TradeHistoryNotesField from "../TradeHistoryNotesField";
import JsonTreeViewer from "@/components/ui/JsonTreeViewer";
import type { RuntimeMode } from "@/lib/system/runtime";
import type { RuntimeDashboardState } from "@/lib/system/dashboard";
import type { VolatilityPoint } from "@/lib/system/types";

import type { SortKey, TradeHistoryAccount } from "./types";
import {
  formatPercent,
  formatTradeTime,
  formatUsdt,
  getEntryMarginUsdt,
} from "./format";
import {
  DRAWDOWN_COLOR_RANGES,
  HOLD_DURATION_COLOR_RANGES,
  PROFIT_LOSS_COLOR_RANGES,
  RUN_UP_COLOR_RANGES,
} from "./colors";
import { FeatureCell, MetricTooltip, TradeAuditMessage } from "./cells";
import TradeChartDialog from "./TradeChartDialog";

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
              const holdMs =
                (row.closed?.t ?? 0) - row.opened.t;
              const feeUsdt = positionData.fees.totalUsdt(row);
              const pnlPercent = row.pnl.netPct ?? 0;
              const pnlUsdt = row.pnl.netUsdt ?? 0;
              const entryMarginUsdt = getEntryMarginUsdt(row);
              const lastMonitoringStage = row.lastMonitoringStage;
              const account = accountBySlug.get(row.account);
              const accountName = account?.name.trim() || row.account;
              const tradingNotes = account?.trading?.notes.trim();
              const legMeta = pair.meta.ofPosition(row);

              return (
                <TableRow key={buildRowKey(row, index)} hover>
                  <TableCell>
                    <Typography
                      variant="body2"
                      component="div"
                      fontWeight="bold"
                      sx={{
                        borderLeft: `${row.direction === "SHORT" ? "5px solid #f44336" : "5px solid #4caf50"}`,
                        borderBottom: `5px solid ${EXCHANGE_COLOR_MAP[exchangeType] ?? "transparent"}`,
                        px: 1,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 0.5,
                      }}
                      title={`${row.symbol} ${exchangeType} ${row.direction ?? "LONG"}`}
                      gutterBottom
                    >
                      {row.symbol}
                      {typeof row.exposure.leverage === "number" && row.exposure.leverage > 1 ? (
                        <Chip
                          label={`${row.exposure.leverage}x`}
                          size="small"
                          sx={{
                            height: 18,
                            fontSize: "0.6rem",
                            bgcolor: "rgba(0,0,0,0.05)",
                          }}
                        />
                      ) : null}
                    </Typography>
                    <br />

                    {/* BOTH:TRADE_HISTORY_ACCOUNT_CHIP */}
                    <MetricTooltip
                      title={tradingNotes || "No trading notes."}
                    >
                      <Chip
                        aria-label={`Account ${accountName}`}
                        label={accountName}
                        size="small"
                        sx={{
                          fontSize: "0.65rem",
                          height: 20,
                          mb: 0.25,
                          "& .MuiChip-label": { px: 0.75 },
                        }}
                        tabIndex={0}
                        variant="outlined"
                      />
                    </MetricTooltip>

                    {/* BOTH:TRADE_HISTORY_ROLE_CHIP */}
                    {legMeta && (
                      <MetricTooltip
                        title={`Pair ${legMeta.pairId}${legMeta.reopen ? " — role re-entry" : ""}`}
                      >
                        <Chip
                          aria-label={`Role ${legMeta.role}`}
                          color={
                            legMeta.role === "MAIN" ? "primary" : "secondary"
                          }
                          label={legMeta.role}
                          size="small"
                          sx={{
                            fontSize: "0.65rem",
                            height: 20,
                            mb: 0.25,
                            ml: 0.5,
                            "& .MuiChip-label": { px: 0.75 },
                          }}
                          tabIndex={0}
                          variant="outlined"
                        />
                      </MetricTooltip>
                    )}

                    {lastMonitoringStage?.stage === "standard" && (
                      <>
                        {/* BOTH:TRADE_HISTORY_EXIT_MONITORING_STAGE */}
                        <Typography
                          color="text.secondary"
                          display="block"
                          variant="caption"
                        >
                          Last stage: standard
                        </Typography>
                        <Typography
                          color="text.secondary"
                          display="block"
                          variant="caption"
                          sx={{
                            lineHeight: 1.4,
                            mt: 0.25,
                            overflowWrap: "anywhere",
                          }}
                        >
                          Reason: {lastMonitoringStage.reason.trim() || "—"}
                        </Typography>
                      </>
                    )}
                    {/* <Chip label={row.tradingMode} size="small" variant="outlined" /> */}
                  </TableCell>
                  <TableCell
                    aria-label={`PnL history and level sequence for ${row.symbol}`}
                  >
                    <NetProfitPercentHistorySparkline
                      history={row.pnl.history ?? []}
                      exitTimeMs={row.closed?.t}
                    />
                    <Box sx={{ mt: 0.75, maxWidth: 220 }}>
                      {/* BOTH:REUSABLE_LEVEL_SEQUENCE */}
                      <PositionLevelSequence
                        items={buildHistoryPositionLevelSequence(row)}
                        showTargetAlert={false}
                      />
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" gutterBottom>
                      {formatTradeTime({
                        compareTimeMs: row.closed?.t,
                        timeMs: row.opened.t,
                      })}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" gutterBottom>
                      {row.exposure.averageEntryPrice ? `$${row.exposure.averageEntryPrice.toFixed(6)}` : "—"}
                    </Typography>
                    <Typography variant="body2" gutterBottom>
                      {positionData.entry.label(row)}
                    </Typography>
                    <TradeAuditMessage message={row.opened.message} />
                    <Typography variant="body2" color="text.secondary">
                      {row.opened.vPoint?.id}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <MetricTooltip title="Entry margin assigned to the position in USDT.">
                      <Typography
                        component="span"
                        variant="body1"
                        sx={{ cursor: "help" }}
                      >
                        {entryMarginUsdt > 0
                          ? `$${entryMarginUsdt.toFixed(2)}`
                          : "—"}
                      </Typography>
                    </MetricTooltip>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" gutterBottom>
                      {formatTradeTime({
                        compareTimeMs: row.opened.t,
                        timeMs: row.closed?.t,
                      })}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" gutterBottom>
                      {row.closed?.price ? `$${row.closed?.price.toFixed(6)}` : "—"}
                    </Typography>

                    <Typography variant="body2" color="text.secondary">
                      {positionData.close.label(row)}
                    </Typography>
                    <TradeAuditMessage message={row.closed?.message} />

                    <Typography variant="body2" color="text.secondary">
                      {row.closed?.vPoint?.id}
                    </Typography>

                    {!readOnly && (
                      <TradeHistoryNotesField
                        mode={mode}
                        onHistoryChange={onHistoryChange}
                        readOnly={false}
                        row={row}
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    <RangedValueText
                      formatValue={formatHoldMs}
                      ranges={HOLD_DURATION_COLOR_RANGES}
                      value={holdMs}
                      variant="body1"
                    />
                  </TableCell>
                  <TableCell align="center">
                    <MetricTooltip title="Maximum run-up seen while this trade was open. It comes from position.pnl.maxUpPct, calculated from position.pnl.history observations.">
                      <RangedValueText
                        component="span"
                        fallbackColor="text.secondary"
                        formatValue={formatPercent}
                        ranges={RUN_UP_COLOR_RANGES}
                        value={row.pnl.maxUpPct}
                        variant="body1"
                      />
                    </MetricTooltip>
                  </TableCell>
                  <TableCell align="center">
                    <MetricTooltip title="Maximum drawdown seen while this trade was open. It comes from position.pnl.maxDownPct, calculated as the worst position.pnl.history observation.">
                      <RangedValueText
                        component="span"
                        fallbackColor="text.secondary"
                        formatValue={formatPercent}
                        ranges={DRAWDOWN_COLOR_RANGES}
                        value={row.pnl.maxDownPct}
                        variant="body1"
                      />
                    </MetricTooltip>
                  </TableCell>
                  <TableCell align="right">
                    <MetricTooltip title="Maximum fee-aware USDT profit observed while this trade was open. It comes from position.pnl.maxUpUsdt and follows position.pnl.netUsdt movements.">
                      <RangedValueText
                        component="span"
                        fallbackColor="text.secondary"
                        formatValue={formatUsdt}
                        ranges={PROFIT_LOSS_COLOR_RANGES}
                        value={row.pnl.maxUpUsdt}
                        variant="body1"
                      />
                    </MetricTooltip>
                  </TableCell>
                  <TableCell align="right">
                    <MetricTooltip title="Maximum fee-aware USDT loss observed while this trade was open. It comes from position.pnl.maxDownUsdt and follows position.pnl.netUsdt movements.">
                      <RangedValueText
                        component="span"
                        fallbackColor="text.secondary"
                        formatValue={formatUsdt}
                        ranges={PROFIT_LOSS_COLOR_RANGES}
                        value={row.pnl.maxDownUsdt}
                        variant="body1"
                      />
                    </MetricTooltip>
                  </TableCell>
                  <TableCell align="right">
                    <MetricTooltip title="position.pnl.netUsdt. Final closed-trade profit/loss in USDT after round-trip fees. On futures this is calculated from the leveraged position size, so it can be larger than margin-only movement.">
                      <RangedValueText
                        component="div"
                        fallbackColor="text.secondary"
                        fontWeight="bold"
                        formatValue={formatUsdt}
                        ranges={PROFIT_LOSS_COLOR_RANGES}
                        sx={{ cursor: "help" }}
                        value={pnlUsdt}
                        variant="body2"
                      />
                    </MetricTooltip>

                    <MetricTooltip title="position.pnl.netPct. Final closed-trade return percent after round-trip fees. This is unlevered and price-based: entry price to exit price, adjusted by fees. The USDT value is then derived from position size.">
                      <RangedValueText
                        component="div"
                        fallbackColor="text.secondary"
                        formatValue={formatPercent}
                        ranges={PROFIT_LOSS_COLOR_RANGES}
                        sx={{ cursor: "help" }}
                        value={pnlPercent}
                        variant="body2"
                      />
                    </MetricTooltip>

                    <MetricTooltip title="position.fees.entryUsdt + position.closed.feeUsdt. Closed trades record realized total fee in USDT. Historical rows can show 0 when the old record did not contain fees.">
                      <Typography
                        variant="caption"
                        component="div"
                        color="text.secondary"
                        sx={{ fontWeight: 600, cursor: "help" }}
                      >
                        Fee: ${feeUsdt.toFixed(2)}
                      </Typography>
                    </MetricTooltip>
                  </TableCell>
                  <TableCell align="right">
                    {!readOnly && (
                      <IconButton
                        size="small"
                        color="error"
                        title={`Delete trade history for ${row.symbol}`}
                        disabled={deletingKey === buildRowKey(row, index)}
                        onClick={() => {
                          void handleDeleteRow(row, buildRowKey(row, index));
                        }}
                      >
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    )}
                    <TradeChartDialog
                      exchangeType={exchangeType}
                      getVolatilityPoints={getVolatilityPoints}
                      history={history}
                      row={row}
                    />
                    <ButtonDialog
                      size="small"
                      sx={{ my: 1 }}
                      title="JSON"
                      titleLong={`Trade Detail: ${row.symbol}`}
                      maxWidth="md"
                    >
                      {() => (
                        <Box sx={{ p: 2 }}>
                          {/* BOTH:TRADE_HISTORY_JSON_TREE */}
                          <JsonTreeViewer
                            ariaLabel={`${row.symbol} trade JSON tree`}
                            value={row}
                          />
                        </Box>
                      )}
                    </ButtonDialog>

                    <FeatureCell row={row} />
                  </TableCell>
                </TableRow>
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
