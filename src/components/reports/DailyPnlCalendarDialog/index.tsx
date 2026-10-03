"use client";

import {
  Box,
  Chip,
  Grid,
  Typography,
} from "@mui/material";
import { useMemo, useState } from "react";

import { CalendarCell } from "./CalendarCell";
import { getTradeSharpeColor } from "./colors";
import { buildDailyCalendarData, buildMonthProjection } from "./data";
import { HeaderChips } from "./HeaderChips";
import { MonthNavigator } from "./MonthNavigator";
import {
  TooltipChip,
  buildHeaderTooltips,
  buildMonthTradeSharpeTooltip,
} from "./tooltips";
import type {
  DailyPnlCalendarBalanceSnapshot,
  DailyPnlCalendarTrade,
} from "./types";
import {
  WEEKDAY_LABELS,
  formatSharpe,
} from "./utils";

export {
  buildDailyCalendarData,
  buildMonthProjection,
  buildTradePnlBalanceSnapshots,
  calculateMonthlyTradeSharpe,
  toDailyPnlCalendarTrade,
} from "./data";
export { getDailyWinRateColor, getTradeSharpeColor } from "./colors";
export type {
  DailyPnlCalendarBalanceSnapshot,
  DailyPnlCalendarTrade,
} from "./types";

export default function DailyPnlCalendarDialog({
  history,
  balanceSnapshots,
  startingBalanceUSDT,
  description,
}: {
  history: DailyPnlCalendarTrade[];
  balanceSnapshots: DailyPnlCalendarBalanceSnapshot[];
  startingBalanceUSDT?: number;
  description?: string;
}) {
  const {
    bestDay,
    months,
    totalBalancePnlUsdt,
    totalPnlUsdt,
    totalTrades,
    worstDay,
  } = useMemo(
    () => buildDailyCalendarData(history, balanceSnapshots, startingBalanceUSDT),
    [balanceSnapshots, history, startingBalanceUSDT],
  );
  const [selectedMonthKey, setSelectedMonthKey] = useState("");

  if (months.length === 0) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography color="text.secondary">
          No closed trade history or balance snapshot data yet.
        </Typography>
      </Box>
    );
  }

  const selectedMonthIndex = Math.max(
    0,
    months.findIndex((month) =>
      month.monthKey ===
      (months.some((candidate) => candidate.monthKey === selectedMonthKey)
        ? selectedMonthKey
        : months[0].monthKey),
    ),
  );
  const selectedMonth = months[selectedMonthIndex] ?? months[0];
  const monthProjection = buildMonthProjection(selectedMonth);
  const headerTooltips = buildHeaderTooltips({
    bestDay,
    monthProjection,
    selectedMonthTitle: selectedMonth.title,
    totalBalancePnlUsdt,
    totalPnlUsdt,
    totalTrades,
    worstDay,
  });

  return (
    <Box sx={{ p: { xs: 0.5, sm: 2 }, overflowX: "hidden" }}>
      <HeaderChips
        bestDay={bestDay}
        headerTooltips={headerTooltips}
        monthProjection={monthProjection}
        totalBalancePnlUsdt={totalBalancePnlUsdt}
        totalPnlUsdt={totalPnlUsdt}
        totalTrades={totalTrades}
        worstDay={worstDay}
      />

      {description ? (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ mb: { xs: 1, sm: 2 } }}
        >
          {description}
        </Typography>
      ) : null}

      <Box sx={{ mb: { xs: 1, sm: 1.5 } }}>
        <TooltipChip title={buildMonthTradeSharpeTooltip(selectedMonth)}>
          <Chip
            color={getTradeSharpeColor(selectedMonth.tradeSharpe)}
            label={`Trade Sharpe ${formatSharpe(selectedMonth.tradeSharpe)}`}
            size="small"
            variant="outlined"
          />
        </TooltipChip>
      </Box>

      <MonthNavigator
        months={months}
        onSelect={setSelectedMonthKey}
        selectedMonth={selectedMonth}
        selectedMonthIndex={selectedMonthIndex}
      />

      <Grid
        container
        columns={7}
        spacing={{ xs: 0.25, sm: 1 }}
        sx={{ mb: { xs: 0.25, sm: 1 } }}
      >
        {WEEKDAY_LABELS.map((label) => (
          <Grid key={label} size={1} sx={{ minWidth: 0 }}>
            <Typography
              variant="caption"
              color="text.secondary"
              aria-label={label}
              sx={{
                display: "block",
                textAlign: "center",
                fontWeight: 700,
                fontSize: { xs: "0.65rem", sm: "0.75rem" },
              }}
            >
              <Box component="span" sx={{ display: { xs: "inline", sm: "none" } }}>
                {label.slice(0, 1)}
              </Box>
              <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
                {label}
              </Box>
            </Typography>
          </Grid>
        ))}
      </Grid>

      <Grid container columns={7} spacing={{ xs: 0.25, sm: 1 }}>
        {selectedMonth.cells.map((cell, index) => (
          <Grid
            key={`${selectedMonth.monthKey}-${index}`}
            size={1}
            sx={{ minWidth: 0 }}
          >
            {cell ? (
              <CalendarCell cell={cell} />
            ) : (
              <Box sx={{ minHeight: { xs: 88, sm: 166 } }} />
            )}
          </Grid>
        ))}
      </Grid>
    </Box>
  );
}
