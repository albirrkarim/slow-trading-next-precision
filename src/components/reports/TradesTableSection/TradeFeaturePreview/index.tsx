"use client";

import { Box, Typography } from "@mui/material";

import priceNorm from "@/lib/features/price-norm";
import type { RuntimeFeatures } from "@/lib/features/types";
import type { VolatilityPoint } from "@/lib/system/types/market";

import CoinFeatureBlock from "./CoinFeatureBlock";
import { priceNormHistory, summarizeFeaturePreview } from "./data";

export { summarizeFeaturePreview };
export type { FeaturePreviewRow } from "./data";

/**
 * Compact entry-feature preview for a trade row: the `RuntimeFeatures`
 * snapshot captured at entry, one block per coin — BTC market anchor, then
 * the trade's own coin — with one labeled row per topic. Self-gating:
 * renders nothing when the stored payload carries no coin features (e.g.
 * manual entries or non-feature strategies).
 */
export default function TradeFeaturePreview({
  entryTimeMs,
  feature,
  signal,
  symbol,
}: {
  entryTimeMs?: number;
  feature: unknown;
  /** Dataset starting signal; defaults to the snapshot's latest point for trades. */
  signal?: VolatilityPoint;
  symbol: string;
}) {
  const rows = summarizeFeaturePreview(feature, symbol);
  if (!rows) return null;
  const ownRow = rows.find((row) => row.own && row.key !== "BTC");
  const correlation = ownRow
    ? priceNorm.movement.score(
        priceNormHistory(rows.find((row) => row.key === "BTC")?.coin),
        priceNormHistory(ownRow.coin),
      )
    : undefined;
  const defs = (feature as RuntimeFeatures | undefined)?.defs;

  return (
    <Box sx={{ display: "grid", gap: 0.75, mt: 0.75 }}>
      <Typography color="text.secondary" fontWeight={600} variant="caption">
        Features @ entry
      </Typography>
      {rows.map((row) => (
        <CoinFeatureBlock
          correlation={row === ownRow ? correlation : undefined}
          defs={defs}
          entryTimeMs={entryTimeMs}
          key={row.key}
          row={row}
          signal={signal}
        />
      ))}
    </Box>
  );
}
