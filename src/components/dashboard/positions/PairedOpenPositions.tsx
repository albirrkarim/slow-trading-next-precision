"use client";

import { Box, Stack, Typography } from "@mui/material";
import { useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";

import pairBoard from "@/lib/strategies/shared/board";
import pair from "@/lib/strategies/shared/pair";
import type { EntryLegs } from "@/lib/strategies/shared/pair";
import type { RuntimeHistoryPosition } from "@/lib/system/trading";

import PairRow from "./PairRow";
import { useEntryDiagnostics } from "../state/use-entry-diagnostics";

interface PairedOpenPositionsProps {
  /** Participating account slugs (enabled + dashboard filter applied). */
  accounts: string[];
  captureEntryRanAt?: number;
  entryLegs?: Record<string, EntryLegs>;
  positions: RuntimeHistoryPosition[];
  renderOpen: (
    position: RuntimeHistoryPosition,
    index?: number,
  ) => ReactNode;
  slug: string;
  /** Persisted `state.strategy` slot from the dashboard snapshot. */
  strategyState?: unknown;
  /** Management symbols shown on the board. */
  symbols: string[];
  /** Diagnostics reasons keyed `<account>:<SYMBOL>` filling empty streak slots. */
  emptyReasons?: Record<string, string>;
  emptyReasonFallback?: string | ((account: string, symbol: string) => string);
}

export default function PairedOpenPositions(
  props: PairedOpenPositionsProps,
) {
  return pair.isReentrySlug(props.slug) ? (
    <StreakPairedOpenPositions {...props} />
  ) : (
    <PairedOpenPositionsBoard {...props} />
  );
}

/** Streak variant: empty rows pick up the shared entry diagnostics reason. */
function StreakPairedOpenPositions(props: PairedOpenPositionsProps) {
  const { captureEntryRanAt } = props;
  const { error, refresh, snapshot } = useEntryDiagnostics();

  const seenCaptureEntryRanAt = useRef(captureEntryRanAt);
  useEffect(() => {
    if (
      captureEntryRanAt === undefined ||
      captureEntryRanAt === seenCaptureEntryRanAt.current
    ) {
      return;
    }
    seenCaptureEntryRanAt.current = captureEntryRanAt;
    void refresh();
  }, [captureEntryRanAt, refresh]);

  const emptyReasons = useMemo(() => {
    const map: Record<string, string> = {};
    if (error) return map;
    for (const account of snapshot?.accounts ?? []) {
      for (const diagnostic of account.diagnostics) {
        map[`${account.account.slug}:${diagnostic.symbol}`] =
          diagnostic.reason;
      }
    }
    return map;
  }, [error, snapshot]);

  const emptyReasonFallback = error
    ? `Entry decisions unavailable: ${error}`
    : snapshot
      ? (account: string, symbol: string) =>
          `No entry diagnostic available for ${account}:${symbol}.`
      : "Checking entry decisions…";

  return (
    <PairedOpenPositionsBoard
      {...props}
      emptyReasons={emptyReasons}
      emptyReasonFallback={emptyReasonFallback}
    />
  );
}

function PairedOpenPositionsBoard({
  accounts,
  emptyReasons,
  emptyReasonFallback,
  entryLegs,
  positions,
  renderOpen,
  slug,
  strategyState,
  symbols,
}: PairedOpenPositionsProps) {
  const { rows, unpaired } = useMemo(
    () =>
      pairBoard.build({
        accounts,
        entryLegs,
        openPositions: positions,
        slug,
        strategyState,
        symbols,
      }),
    [accounts, entryLegs, positions, slug, strategyState, symbols],
  );

  return (
    <Stack spacing={1}>
      {rows.map((row) => (
        <PairRow
          emptyReason={emptyReasons?.[`${row.account}:${row.symbol}`]}
          emptyReasonFallback={emptyReasonFallback}
          key={row.key}
          renderOpen={renderOpen}
          row={row}
        />
      ))}

      {unpaired.map((position, index) => renderOpen(position, index))}

      {rows.length === 0 && unpaired.length === 0 && (
        <Box
          sx={{
            border: 1,
            borderColor: "divider",
            borderRadius: 1,
            color: "text.secondary",
            p: 2,
            textAlign: "center",
          }}
        >
          <Typography variant="body2">No open positions</Typography>
        </Box>
      )}
    </Stack>
  );
}
