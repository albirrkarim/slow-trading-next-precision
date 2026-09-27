"use client";

import { Box, Stack, Typography } from "@mui/material";
import { useMemo } from "react";
import type { ReactNode } from "react";

import pairBoard from "@/lib/strategies/shared/board";
import type { RuntimeHistoryPosition } from "@/lib/system/trading";

import PairRow from "./PairRow";
import { useEntryDiagnostics } from "./use-entry-diagnostics";

interface PairedOpenPositionsProps {
  /** Participating account slugs (enabled + dashboard filter applied). */
  accounts: string[];
  positions: RuntimeHistoryPosition[];
  renderOpen: (
    position: RuntimeHistoryPosition,
    index?: number,
  ) => ReactNode;
  slug: "both" | "streak";
  /** Persisted `state.strategy` slot from the dashboard snapshot. */
  strategyState?: unknown;
  /** Management symbols shown on the board. */
  symbols: string[];
  /** Diagnostics reasons keyed `<account>:<SYMBOL>` filling empty streak slots. */
  emptyReasons?: Record<string, string>;
}

export default function PairedOpenPositions(
  props: PairedOpenPositionsProps,
) {
  return props.slug === "streak" ? (
    <StreakPairedOpenPositions {...props} />
  ) : (
    <PairedOpenPositionsBoard {...props} />
  );
}

/** Streak variant: empty rows pick up the shared entry diagnostics reason. */
function StreakPairedOpenPositions(props: PairedOpenPositionsProps) {
  const { snapshot } = useEntryDiagnostics();
  const emptyReasons = useMemo(() => {
    const map: Record<string, string> = {};
    for (const account of snapshot?.accounts ?? []) {
      for (const diagnostic of account.diagnostics) {
        map[`${account.account.slug}:${diagnostic.symbol}`] =
          diagnostic.reason;
      }
    }
    return map;
  }, [snapshot]);

  return <PairedOpenPositionsBoard {...props} emptyReasons={emptyReasons} />;
}

function PairedOpenPositionsBoard({
  accounts,
  emptyReasons,
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
        openPositions: positions,
        slug,
        strategyState,
        symbols,
      }),
    [accounts, positions, slug, strategyState, symbols],
  );

  return (
    <Stack spacing={1}>
      {rows.map((row) => (
        <PairRow
          emptyReason={emptyReasons?.[`${row.account}:${row.symbol}`]}
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
