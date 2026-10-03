"use client";

import {
  Box,
  Chip,
} from "@mui/material";

import { getPnlPercentBg } from "@/components/settings/helpers";
import type {
  DashboardState,
  DayPreviewSummary,
  OpenPositionSummary,
} from "../navbar-types";

import { BalanceTooltip, BalanceTooltipText } from "./BalanceTooltip";

interface NavbarDayPreviewSectionProps {
  dashboardState: DashboardState | null;
  dayPreview: DayPreviewSummary;
  openPositionSummary: OpenPositionSummary;
}

export function NavbarDayPreviewSection({
  dashboardState,
  dayPreview,
  openPositionSummary,
}: NavbarDayPreviewSectionProps) {
  return (
    <Box
      sx={{
        display: "flex",
        gap: { xs: 0.5, md: 1 },
        flexWrap: "wrap",
        alignItems: "center",
        gridArea: "pnl",
        justifySelf: { xs: "start", xl: "center" },
        minWidth: 0,
      }}
    >
      {dashboardState ? (
        <>
          <BalanceTooltip
            title={
              <BalanceTooltipText
                description="Open-position floating PnL in USDT. It sums position.pnl.netUsdt across open positions."
                formula="position.pnl.netUsdt = gross price PnL - estimated round-trip fees; futures uses leveraged size"
              />
            }
          >
            <Chip
              size="small"
              label={`PnL: $${openPositionSummary.totalPnlUSDT >= 0 ? "+" : ""}${openPositionSummary.totalPnlUSDT.toFixed(2)}`}
              sx={(theme) => ({
                bgcolor:
                  openPositionSummary.totalPnlUSDT >= 0
                    ? theme.palette.success.main
                    : theme.palette.error.main,
                color: theme.palette.getContrastText(
                  openPositionSummary.totalPnlUSDT >= 0
                    ? theme.palette.success.main
                    : theme.palette.error.main,
                ),
                fontWeight: "bold",
              })}
            />
          </BalanceTooltip>
          <BalanceTooltip
            title={
              <BalanceTooltipText
                description="Average floating PnL percent across open positions."
                formula="avg = average(position.pnl.netPct)"
              />
            }
          >
            <Chip
              size="small"
              label={`Avg: ${openPositionSummary.avgPnlPercent.toFixed(2)}%`}
              sx={(theme) => ({
                bgcolor: getPnlPercentBg(
                  theme,
                  openPositionSummary.avgPnlPercent,
                ),
                color: theme.palette.getContrastText(
                  getPnlPercentBg(theme, openPositionSummary.avgPnlPercent),
                ),
                fontWeight: "bold",
              })}
            />
          </BalanceTooltip>
          <BalanceTooltip
            title={
              <BalanceTooltipText
                description="Today's realized closed-trade PnL in USDT from trade history."
                formula="USD = sum(history.pnl.netUsdt for today)"
              />
            }
          >
            <Chip
              size="small"
              label={`USD: ${dayPreview.dailyUsdtProfit >= 0 ? "+" : ""}$${dayPreview.dailyUsdtProfit.toFixed(2)}`}
              sx={(theme) => ({
                bgcolor:
                  dayPreview.dailyUsdtProfit >= 0
                    ? theme.palette.success.main
                    : theme.palette.error.main,
                color: theme.palette.getContrastText(
                  dayPreview.dailyUsdtProfit >= 0
                    ? theme.palette.success.main
                    : theme.palette.error.main,
                ),
                fontWeight: "bold",
              })}
            />
          </BalanceTooltip>
          <BalanceTooltip
            title={
              <BalanceTooltipText
                description="Today's realized closed-trade PnL percent from trade history."
                formula="PnL % = sum(history.pnl.netPct for today)"
              />
            }
          >
            <Chip
              size="small"
              label={`PnL: ${dayPreview.dailyPnlPercentSum >= 0 ? "+" : ""}${dayPreview.dailyPnlPercentSum.toFixed(2)}%`}
              sx={(theme) => ({
                bgcolor: getPnlPercentBg(theme, dayPreview.dailyPnlPercentSum),
                color: theme.palette.getContrastText(
                  getPnlPercentBg(theme, dayPreview.dailyPnlPercentSum),
                ),
                fontWeight: "bold",
              })}
            />
          </BalanceTooltip>
        </>
      ) : null}
    </Box>
  );
}
