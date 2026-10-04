"use client";

import ShowChartIcon from "@mui/icons-material/ShowChart";
import { Box, IconButton, Typography } from "@mui/material";
import ButtonDialog from "@/components/ui/ButtonDialog";
import TradeChartBase from "@/components/charts/TradeChartBase";
import format from "@/lib/system/utils/format";
import PositionLevelSequence, {
  buildHistoryPositionLevelSequence,
} from "@/components/charts/PositionLevelSequence";
import pair from "@/lib/strategies/shared/pair";
import { buildTradeMarkersFromHistory } from "@/lib/system/utils/ui/trade-markers";
import type { ExchangeType } from "@/lib/exchange";
import type { VolatilityPoint } from "@/lib/system/types";
import type { ReportRow } from "../types";
import { TRADE_CHART_CONTEXT_MS } from "./format";

function buildTradeChartPosition(row: ReportRow) {
  return row;
}

export default function TradeChartDialog({
  exchangeType,
  getVolatilityPoints,
  history,
  row,
}: {
  exchangeType: ExchangeType;
  getVolatilityPoints?: (symbol: string) => VolatilityPoint[] | undefined;
  history: ReportRow[];
  row: ReportRow;
}) {
  const tradeEndMs = row.closed?.t ?? row.opened.t;
  const focusPadMs = Math.max(
    (tradeEndMs - row.opened.t) * 0.5,
    15 * 60_000,
  );
  const legMeta = pair.meta.ofPosition(row);
  const legPrefix = legMeta ? `${legMeta.role} leg ` : "";

  return (
    <ButtonDialog
      title="Chart"
      titleLong={`${row.symbol} — Trade Chart`}
      maxWidth="xl"
      customButton={(handleOpen) => (
        <IconButton
          size="small"
          onClick={handleOpen}
          title="View trade chart"
          color="primary"
        >
          <ShowChartIcon fontSize="small" />
        </IconButton>
      )}
    >
      {() => (
        <Box sx={{ p: 1, backgroundColor: "background.default" }}>
          <TradeChartBase
            activePosition={buildTradeChartPosition(row)}
            defaultInterval="1m"
            symbol={row.symbol}
            exchange={exchangeType}
            marketType={
              (row.tradingMode?.toUpperCase() as any) ??
              (exchangeType === "tokocrypto" ? "SPOT" : "FUTURES")
            }
            markers={buildTradeMarkersFromHistory(history, row.symbol, (trade) =>
              pair.meta.ofPosition(trade as ReportRow)?.role,
            )}
            startTimeMs={row.opened.t - TRADE_CHART_CONTEXT_MS}
            endTimeMs={tradeEndMs + TRADE_CHART_CONTEXT_MS}
            initialVisibleRangeMs={{
              start: row.opened.t - focusPadMs,
              end: tradeEndMs + focusPadMs,
            }}
            volatilitySource="storage"
            customVolatilityPoints={getVolatilityPoints?.(row.symbol)}
            header={
              <>
                <Typography variant="body2">
                  <strong>Account:</strong> {row.account}
                </Typography>
                <Typography variant="body2">
                  <strong>{legPrefix}Entry:</strong> {row.exposure.averageEntryPrice?.toFixed(6)} @{" "}
                  {row.opened.t
                    ? format.timeForLog(row.opened.t)
                    : "—"}
                </Typography>
                <Typography variant="body2">
                  <strong>{legPrefix}Exit:</strong> {row.closed?.price?.toFixed(6)} @{" "}
                  {row.closed?.t ? format.timeForLog(row.closed.t) : "—"}
                </Typography>
                <Typography
                  variant="body2"
                  sx={{
                    color:
                      (row.pnl.netPct ?? 0) >= 0
                        ? "success.main"
                        : "error.main",
                    fontWeight: "bold",
                  }}
                >
                  PnL: {(row.pnl.netPct ?? 0) >= 0 ? "+" : ""}
                  {(row.pnl.netPct ?? 0).toFixed(2)}% ($
                  {(row.pnl.netUsdt ?? 0).toFixed(2)})
                </Typography>
                <Box sx={{ flexBasis: "100%" }}>
                  {/* BOTH:REUSABLE_LEVEL_SEQUENCE */}
                  <PositionLevelSequence
                    items={buildHistoryPositionLevelSequence(row)}
                    showTargetAlert={false}
                  />
                </Box>
              </>
            }
          />
        </Box>
      )}
    </ButtonDialog>
  );
}
