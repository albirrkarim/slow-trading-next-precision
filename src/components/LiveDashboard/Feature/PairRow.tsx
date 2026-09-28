"use client";

import { Box, Grid, Typography } from "@mui/material";
import type { ReactNode } from "react";

import type { PairBoardRow } from "@/lib/strategies/shared/board";
import type { RuntimeHistoryPosition } from "@/lib/system/trading";

import PairSlotCard from "./PairSlotCard";

interface PairRowProps {
  row: PairBoardRow;
  /** Diagnostics explanation for a fully-empty streak row. */
  emptyReason?: string;
  emptyReasonFallback?: string | ((account: string, symbol: string) => string);
  renderOpen: (position: RuntimeHistoryPosition) => ReactNode;
}

export default function PairRow({
  emptyReason,
  emptyReasonFallback,
  renderOpen,
  row,
}: PairRowProps) {
  const net = Number(row.netUsdt) || 0;
  const fallback =
    typeof emptyReasonFallback === "function"
      ? emptyReasonFallback(row.account, row.symbol)
      : emptyReasonFallback;
  return (
    <Grid container spacing={1} alignItems="stretch">
      <Grid size={{ md: 5, xs: 12 }}>
        <PairSlotCard
          emptyReason={emptyReason}
          emptyReasonFallback={fallback}
          renderOpen={renderOpen}
          role="MAIN"
          slot={row.slots.MAIN}
        />
      </Grid>
      <Grid size={{ md: 2, xs: 12 }}>
        <Box
          sx={{
            alignItems: "center",
            display: "flex",
            flexDirection: "column",
            height: "100%",
            justifyContent: "center",
          }}
        >
          <Typography fontWeight={700} variant="body2">
            {row.symbol}
          </Typography>
          <Typography color="text.secondary" variant="caption">
            {row.account}
          </Typography>
          <Typography
            color={net >= 0 ? "success.main" : "error.main"}
            fontWeight={700}
            variant="body2"
          >
            {net >= 0 ? "+" : ""}
            {net.toFixed(2)} USDT
          </Typography>
        </Box>
      </Grid>
      <Grid size={{ md: 5, xs: 12 }}>
        <PairSlotCard
          emptyReason={emptyReason}
          emptyReasonFallback={fallback}
          renderOpen={renderOpen}
          role="COUNTER"
          slot={row.slots.COUNTER}
        />
      </Grid>
    </Grid>
  );
}
