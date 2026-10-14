"use client";

import TrendingDownIcon from "@mui/icons-material/TrendingDown";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import { Chip } from "@mui/material";

import type { PositionDirection } from "@/lib/system/trading";

export default function DirectionChip({ direction }: { direction: PositionDirection }) {
  const long = direction !== "SHORT";
  return (
    <Chip
      color={long ? "success" : "error"}
      icon={long ? <TrendingUpIcon /> : <TrendingDownIcon />}
      label={long ? "LONG" : "SHORT"}
      size="small"
      sx={{ fontWeight: 700 }}
    />
  );
}
