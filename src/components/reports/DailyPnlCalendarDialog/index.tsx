"use client";

import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { alpha, lighten } from "@mui/material/styles";
import {
  Box,
  Chip,
  Divider,
  Grid,
  IconButton,
  MenuItem,
  Paper,
  Select,
  Typography,
} from "@mui/material";
import { useMemo, useState } from "react";

import WinRateBadge from "./WinRateBadge";
import { getDailyPnlTintOpacity, getTradeSharpeColor } from "./colors";
import { buildDailyCalendarData, buildMonthProjection } from "./data";
import {
  TooltipChip,
  TooltipText,
  buildHeaderTooltips,
  buildMetricTooltips,
  buildMonthTradeSharpeTooltip,
} from "./tooltips";
import type {
  DailyPnlCalendarBalanceSnapshot,
  DailyPnlCalendarTrade,
} from "./types";
import {
  WEEKDAY_LABELS,
  formatCompactSignedPercent,
  formatCompactSignedUsdt,
  formatSharpe,
  formatSignedPercent,
  formatSignedUsdt,
  formatUsdt,
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

      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1,
          mb: { xs: 1, sm: 2 },
          flexWrap: "wrap",
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 0.5,
            width: { xs: "100%", sm: "auto" },
          }}
        >
          <IconButton
            size="small"
            onClick={() =>
              setSelectedMonthKey(
                months[selectedMonthIndex + 1]?.monthKey ?? selectedMonth.monthKey,
              )
            }
            disabled={selectedMonthIndex >= months.length - 1}
            title="Older month"
          >
            <ChevronLeftIcon />
          </IconButton>

          <Typography
            variant="h6"
            sx={{
              flex: { xs: 1, sm: "initial" },
              minWidth: { xs: 0, sm: 180 },
              textAlign: "center",
            }}
          >
            {selectedMonth.title}
          </Typography>

          <IconButton
            size="small"
            onClick={() =>
              setSelectedMonthKey(
                months[selectedMonthIndex - 1]?.monthKey ?? selectedMonth.monthKey,
              )
            }
            disabled={selectedMonthIndex <= 0}
            title="Newer month"
          >
            <ChevronRightIcon />
          </IconButton>
        </Box>

        <Select
          size="small"
          value={selectedMonth.monthKey}
          onChange={(event) => setSelectedMonthKey(event.target.value)}
          sx={{ display: { xs: "none", sm: "inline-flex" }, minWidth: 220 }}
        >
          {months.map((month) => (
            <MenuItem key={month.monthKey} value={month.monthKey}>
              {month.title}
            </MenuItem>
          ))}
        </Select>
      </Box>

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
        {selectedMonth.cells.map((cell, index) => {
          const hasTrades = (cell?.trades ?? 0) > 0;
          const tradePnlUsdt = cell?.tradePnlUsdt ?? 0;
          const hasDirectionalPnl = hasTrades && tradePnlUsdt !== 0;
          const balancePnlUsdt = cell?.balancePnlUsdt ?? null;
          const balanceToneValue = balancePnlUsdt ?? 0;
          const tooltips = cell ? buildMetricTooltips(cell) : null;
          const dailyPnlTintOpacity = cell
            ? getDailyPnlTintOpacity(cell.monthlyPnlShare)
            : 0;

          return (
            <Grid
              key={`${selectedMonth.monthKey}-${index}`}
              size={1}
              sx={{ minWidth: 0 }}
            >
              {cell ? (
                <Paper
                  elevation={0}
                  sx={(theme) => ({
                    minHeight: { xs: 88, sm: 166 },
                    p: { xs: 0.375, sm: 1 },
                    overflow: "hidden",
                    border: `1px solid ${theme.palette.divider}`,
                    "& .MuiTypography-root": hasDirectionalPnl
                      ? { color: theme.palette.common.black }
                      : undefined,
                    backgroundColor: hasDirectionalPnl
                      ? tradePnlUsdt > 0
                        ? lighten(
                            theme.palette.success.main,
                            1 - dailyPnlTintOpacity,
                          )
                        : lighten(
                            theme.palette.error.main,
                            1 - dailyPnlTintOpacity,
                          )
                      : alpha(theme.palette.action.hover, 0.35),
                  })}
                >
                  <Typography
                    variant="caption"
                    sx={{
                      display: "block",
                      fontWeight: 700,
                      fontSize: { xs: "0.625rem", sm: "0.75rem" },
                      lineHeight: 1.2,
                    }}
                  >
                    {cell.dayOfMonth}
                  </Typography>

                  <Box
                    sx={{
                      display: { xs: "block", sm: "none" },
                      mt: 0.375,
                      fontVariantNumeric: "tabular-nums",
                      "& .MuiTypography-root": {
                        fontSize: "clamp(0.52rem, 2.15vw, 0.65rem)",
                        lineHeight: 1.25,
                        overflow: "hidden",
                        textOverflow: "clip",
                        whiteSpace: "nowrap",
                      },
                    }}
                  >
                    <Typography
                      sx={{
                        fontWeight: 700,
                        color: hasTrades
                          ? tradePnlUsdt >= 0
                            ? "success.main"
                            : "error.main"
                          : "text.secondary",
                      }}
                    >
                      <TooltipText title={tooltips?.trade}>
                        T {hasTrades ? formatCompactSignedUsdt(tradePnlUsdt) : "$0"}
                      </TooltipText>
                    </Typography>
                    <Typography
                      color={
                        hasTrades
                          ? cell.tradePnlPercent >= 0
                            ? "success.main"
                            : "error.main"
                          : "text.secondary"
                      }
                    >
                      <TooltipText title={tooltips?.tradePnlPercent}>
                        {hasTrades
                          ? formatCompactSignedPercent(cell.tradePnlPercent)
                          : "—"}
                      </TooltipText>
                    </Typography>
                    <Typography
                      color={
                        balancePnlUsdt !== null
                          ? balanceToneValue >= 0
                            ? "success.main"
                            : "error.main"
                          : "text.secondary"
                      }
                    >
                      <TooltipText title={tooltips?.balance}>
                        B {balancePnlUsdt !== null
                          ? formatCompactSignedUsdt(balancePnlUsdt)
                          : "—"}
                      </TooltipText>
                    </Typography>
                    <Typography
                      color={
                        balancePnlUsdt !== null
                          ? balanceToneValue >= 0
                            ? "success.main"
                            : "error.main"
                          : "text.secondary"
                      }
                    >
                      <TooltipText title={tooltips?.balancePnl}>
                        {formatCompactSignedPercent(cell.balancePnlPercentOfStart)}
                      </TooltipText>
                    </Typography>
                    <Typography color="text.secondary">
                      <TooltipText title={tooltips?.trades}>
                        {cell.trades}t ·{" "}
                        {hasTrades ? (
                          <WinRateBadge compact winRate={cell.winRate} />
                        ) : (
                          "—"
                        )}
                      </TooltipText>
                    </Typography>
                  </Box>

                  <Box sx={{ display: { xs: "none", sm: "block" }, mt: 1 }}>
                    <Typography
                      variant="body2"
                      sx={{
                        fontWeight: 700,
                        color: hasTrades
                          ? tradePnlUsdt >= 0
                            ? "success.main"
                            : "error.main"
                          : "text.secondary",
                      }}
                    >
                      <TooltipText title={tooltips?.trade}>
                        Trade: {hasTrades ? formatSignedUsdt(tradePnlUsdt) : "$0.00"}
                      </TooltipText>
                    </Typography>
                    <Typography
                      variant="caption"
                      color={
                        hasTrades
                          ? cell.tradePnlPercent >= 0
                            ? "success.main"
                            : "error.main"
                          : "text.secondary"
                      }
                      sx={{ display: "block" }}
                    >
                      <TooltipText title={tooltips?.tradePnlPercent}>
                        Trade PnL: {hasTrades
                          ? formatSignedPercent(cell.tradePnlPercent)
                          : "—"}
                      </TooltipText>
                    </Typography>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: "block" }}
                    >
                      <TooltipText title={tooltips?.winRate}>
                        Win rate:{" "}
                        {hasTrades ? (
                          <WinRateBadge winRate={cell.winRate} />
                        ) : (
                          "—"
                        )}
                      </TooltipText>
                    </Typography>
                    <Typography
                      variant="caption"
                      color={
                        balancePnlUsdt !== null
                          ? balanceToneValue >= 0
                            ? "success.main"
                            : "error.main"
                          : "text.secondary"
                      }
                      sx={{ display: "block" }}
                    >
                      <TooltipText title={tooltips?.balance}>
                        Bal:{" "}
                        {balancePnlUsdt !== null
                          ? formatSignedUsdt(balancePnlUsdt)
                          : "—"}
                      </TooltipText>
                    </Typography>
                    <Typography
                      variant="caption"
                      color={
                        balancePnlUsdt !== null
                          ? balanceToneValue >= 0
                            ? "success.main"
                            : "error.main"
                          : "text.secondary"
                      }
                      sx={{ display: "block" }}
                    >
                      <TooltipText title={tooltips?.balancePnl}>
                        Bal PnL: {formatSignedPercent(cell.balancePnlPercentOfStart)}
                      </TooltipText>
                    </Typography>
                  </Box>

                  <Box sx={{ display: { xs: "none", sm: "block" } }}>
                    <Divider sx={{ my: 0.75 }} />

                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: "block" }}
                    >
                      <TooltipText title={tooltips?.trades}>
                        {cell.trades} trade{cell.trades === 1 ? "" : "s"}
                      </TooltipText>
                    </Typography>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: "block" }}
                    >
                      <TooltipText title={tooltips?.start}>
                        Start: {formatUsdt(cell.startBalance)}
                      </TooltipText>
                    </Typography>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: "block" }}
                    >
                      <TooltipText title={tooltips?.end}>
                        End: {formatUsdt(cell.endBalance)}
                      </TooltipText>
                    </Typography>
                  </Box>
                </Paper>
              ) : (
                <Box sx={{ minHeight: { xs: 88, sm: 166 } }} />
              )}
            </Grid>
          );
        })}
      </Grid>
    </Box>
  );
}
