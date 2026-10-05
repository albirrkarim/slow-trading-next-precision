"use client";

import ButtonDialog from "@/components/ui/ButtonDialog";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import {
  Box,
  Chip,
  IconButton,
  TableCell,
  TableRow,
  Typography,
} from "@mui/material";
import { NetProfitPercentHistorySparkline } from "@/components/charts/NetProfitPercentHistorySparkline";
import PositionLevelSequence, {
  buildHistoryPositionLevelSequence,
} from "@/components/charts/PositionLevelSequence";
import { EXCHANGE_COLOR_MAP } from "@/components/charts/constants";
import type { ExchangeType } from "@/lib/exchange";

import RangedValueText from "../RangedValueText";
import type { ReportRow } from "../types";
import { formatHoldMs } from "../utils";
import { positionData } from "@/lib/system/trading";
import pair from "@/lib/strategies/shared/pair";
import TradeHistoryNotesField from "../TradeHistoryNotesField";
import JsonTreeViewer from "@/components/ui/JsonTreeViewer";
import type { RuntimeMode } from "@/lib/system/runtime";
import type { RuntimeDashboardState } from "@/lib/system/dashboard";
import type { VolatilityPoint } from "@/lib/system/types";

import type { TradeHistoryAccount } from "./types";
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
import TradeFeaturePreview from "./TradeFeaturePreview";

export function TradeTableRow({
  accountBySlug,
  deletingKey,
  exchangeType,
  getVolatilityPoints,
  history,
  mode,
  onDeleteRow,
  onHistoryChange,
  readOnly,
  row,
  rowKey,
}: {
  accountBySlug: Map<string, TradeHistoryAccount>;
  deletingKey: string | null;
  exchangeType: ExchangeType;
  getVolatilityPoints?: (symbol: string) => VolatilityPoint[] | undefined;
  history: ReportRow[];
  mode: RuntimeMode;
  onDeleteRow: (row: ReportRow, rowKey: string) => void;
  onHistoryChange: (
    nextHistory: RuntimeDashboardState["history"],
    refreshDashboard?: boolean,
  ) => void;
  readOnly: boolean;
  row: ReportRow;
  rowKey: string;
}) {
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
    <TableRow hover>
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
          <TradeFeaturePreview
            entryTimeMs={row.opened.t}
            feature={row.strategy.entry.feature}
            symbol={row.symbol}
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
            disabled={deletingKey === rowKey}
            onClick={() => {
              void onDeleteRow(row, rowKey);
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
}
