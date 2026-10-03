"use client";

import { alpha, lighten } from "@mui/material/styles";
import {
  Box,
  Divider,
  Paper,
  Typography,
} from "@mui/material";

import WinRateBadge from "./WinRateBadge";
import { getDailyPnlTintOpacity } from "./colors";
import { TooltipText, buildMetricTooltips } from "./tooltips";
import type { DailyCalendarCell } from "./types";
import {
  formatCompactSignedPercent,
  formatCompactSignedUsdt,
  formatSignedPercent,
  formatSignedUsdt,
  formatUsdt,
} from "./utils";

export function CalendarCell({ cell }: { cell: DailyCalendarCell }) {
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
  );
}
