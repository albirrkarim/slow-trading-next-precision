"use client";

import { Box } from "@mui/material";

import { getDailyWinRateColor } from "./colors";
import { formatCompactSignedPercent, formatWinRate } from "./utils";

export default function WinRateBadge({
  compact = false,
  winRate,
}: {
  compact?: boolean;
  winRate: number;
}) {
  return (
    <Box
      component="span"
      sx={{
        px: compact ? 0.25 : 0.375,
        borderRadius: 0.5,
        backgroundColor: "common.white",
        color: getDailyWinRateColor(winRate),
        fontWeight: 700,
      }}
    >
      {compact
        ? formatCompactSignedPercent(winRate).replace("+", "")
        : formatWinRate(winRate)}
    </Box>
  );
}
