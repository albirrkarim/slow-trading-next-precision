"use client";

import { Chip, Paper, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";

import type { PairRole } from "@/lib/strategies/shared/pair";
import type { PairBoardSlot } from "@/lib/strategies/shared/board";
import type { RuntimeHistoryPosition } from "@/lib/system/trading";

interface PairSlotCardProps {
  role: PairRole;
  slot: PairBoardSlot;
  /** Diagnostics explanation used when the slot itself carries no reason. */
  emptyReason?: string;
  emptyReasonFallback?: string;
  /** Renders an open leg with the shared OpenPositionItem card. */
  renderOpen: (position: RuntimeHistoryPosition) => ReactNode;
}

export default function PairSlotCard({
  emptyReason,
  emptyReasonFallback,
  renderOpen,
  role,
  slot,
}: PairSlotCardProps) {
  if (slot.kind === "open") {
    return <>{renderOpen(slot.position)}</>;
  }

  if (slot.kind === "closed") {
    const { leg } = slot;
    const pnl = Number(leg.pnl.usdt) || 0;
    return (
      <Paper
        sx={{ bgcolor: "background.paper", p: 1.25 }}
        variant="outlined"
      >
        <Stack
          alignItems="center"
          direction="row"
          gap={0.75}
          sx={{ mb: 0.5 }}
        >
          <Typography fontWeight={700} variant="body2">
            {role}
          </Typography>
          <Typography color="text.secondary" variant="caption">
            {leg.direction}
          </Typography>
          <Chip
            color="default"
            label="Closed"
            size="small"
            sx={{ height: 20, ml: "auto" }}
            variant="outlined"
          />
        </Stack>
        <Typography color="text.secondary" variant="caption">
          {leg.opened.price} → {leg.closed.price ?? "—"}
        </Typography>
        <Stack alignItems="center" direction="row" gap={0.75}>
          <Typography
            color={pnl >= 0 ? "success.main" : "error.main"}
            fontWeight={700}
            variant="body2"
          >
            {pnl >= 0 ? "+" : ""}
            {pnl.toFixed(2)} USDT ({leg.pnl.pct.toFixed(2)}%)
          </Typography>
          {leg.closed.reason && (
            <Typography color="text.secondary" variant="caption">
              {leg.closed.message ?? leg.closed.reason}
            </Typography>
          )}
        </Stack>
      </Paper>
    );
  }

  return (
    <Paper sx={{ p: 1.25 }} variant="outlined">
      <Stack alignItems="center" direction="row" gap={0.75}>
        <Typography fontWeight={700} variant="body2">
          {role}
        </Typography>
        <Typography color="text.secondary" variant="caption">
          {slot.reason ??
            emptyReason ??
            emptyReasonFallback ??
            "No open pair — waiting for a fresh pair entry signal."}
        </Typography>
      </Stack>
    </Paper>
  );
}
