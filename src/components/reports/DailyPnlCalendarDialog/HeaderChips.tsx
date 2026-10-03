"use client";

import { Box, Chip } from "@mui/material";

import type { buildHeaderTooltips } from "./tooltips";
import { TooltipChip } from "./tooltips";
import type { DailyCalendarCell, MonthProjection } from "./types";
import {
  formatSignedPercent,
  formatSignedUsdt,
  formatUsdt,
} from "./utils";

type HeaderTooltips = ReturnType<typeof buildHeaderTooltips>;
type BestWorstDay = DailyCalendarCell | null;

export function HeaderChips(props: {
  bestDay: BestWorstDay;
  headerTooltips: HeaderTooltips;
  monthProjection: MonthProjection | null;
  totalBalancePnlUsdt: number | null;
  totalPnlUsdt: number;
  totalTrades: number;
  worstDay: BestWorstDay;
}) {
  const {
    bestDay,
    headerTooltips,
    monthProjection,
    totalBalancePnlUsdt,
    totalPnlUsdt,
    totalTrades,
    worstDay,
  } = props;

  return (
    <Box
      sx={{
        display: "flex",
        gap: { xs: 0.5, sm: 1 },
        flexWrap: "wrap",
        mb: { xs: 1, sm: 2 },
        "& .MuiChip-root": { maxWidth: "100%" },
      }}
    >
      <TooltipChip title={headerTooltips.tradeTotal}>
        <Chip
          label={`Trade Total ${formatSignedUsdt(totalPnlUsdt)}`}
          color={totalPnlUsdt >= 0 ? "success" : "error"}
        />
      </TooltipChip>
      {totalBalancePnlUsdt !== null ? (
        <TooltipChip title={headerTooltips.balanceTotal}>
          <Chip
            label={`Balance Δ ${formatSignedUsdt(totalBalancePnlUsdt)}`}
            color={totalBalancePnlUsdt >= 0 ? "success" : "error"}
            variant="outlined"
          />
        </TooltipChip>
      ) : null}
      <TooltipChip title={headerTooltips.trades}>
        <Chip label={`Trades ${totalTrades}`} variant="outlined" />
      </TooltipChip>
      {monthProjection ? (
        <TooltipChip title={headerTooltips.avgProfitPerDay}>
          <Chip
            label={`Avg/day ${formatSignedUsdt(monthProjection.averageTradePnlPerDay)}`}
            color={monthProjection.averageTradePnlPerDay >= 0 ? "success" : "error"}
            variant="outlined"
          />
        </TooltipChip>
      ) : null}
      {monthProjection ? (
        <TooltipChip title={headerTooltips.estimatedMonthProfit}>
          <Chip
            label={`Est Month ${formatSignedUsdt(monthProjection.estimatedMonthTradePnlUsdt)} (${formatSignedPercent(monthProjection.estimatedMonthTradePnlPercentOfStart)}) End ${formatUsdt(monthProjection.estimatedEndBalance)}`}
            color={
              monthProjection.estimatedMonthTradePnlUsdt >= 0
                ? "success"
                : "error"
            }
            variant="outlined"
          />
        </TooltipChip>
      ) : null}
      {bestDay ? (
        <TooltipChip title={headerTooltips.bestDay}>
          <Chip
            label={`Best ${bestDay.day}: ${formatSignedUsdt(bestDay.tradePnlUsdt)}`}
            color="success"
            variant="outlined"
          />
        </TooltipChip>
      ) : null}
      {worstDay ? (
        <TooltipChip title={headerTooltips.worstDay}>
          <Chip
            label={`Worst ${worstDay.day}: ${formatSignedUsdt(worstDay.tradePnlUsdt)}`}
            color="error"
            variant="outlined"
          />
        </TooltipChip>
      ) : null}
    </Box>
  );
}
