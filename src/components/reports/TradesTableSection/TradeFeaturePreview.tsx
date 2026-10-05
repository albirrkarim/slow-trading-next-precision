"use client";

import { Box, Typography } from "@mui/material";
import moment from "moment";

import { PriceNormalizedHistorySparkline } from "@/components/charts/PriceNormalizedHistorySparkline";
import type { CoinFeatures, RuntimeFeatures } from "@/lib/features/types";

export interface FeaturePreviewRow {
  /** Min/max/span over the coin's `priceNormalizedHistory` plus its current value. */
  bounds?: {
    firstT?: number;
    lastT?: number;
    max: number;
    min: number;
    samples: number;
  };
  coin?: CoinFeatures;
  key: string;
}

function historyBounds(
  coin: CoinFeatures | undefined,
): FeaturePreviewRow["bounds"] {
  const history = Array.isArray(coin?.priceNormalizedHistory)
    ? coin.priceNormalizedHistory.filter(
        (point) =>
          Number.isFinite(point?.p) && Number.isFinite(point?.t),
      )
    : [];
  const values = history.map((point) => point.p);
  if (coin?.priceNormalized !== undefined) {
    values.push(coin.priceNormalized);
  }
  if (values.length === 0) return undefined;
  const times = history.map((point) => point.t);
  return {
    firstT: times.length > 0 ? Math.min(...times) : undefined,
    lastT: times.length > 0 ? Math.max(...times) : undefined,
    max: Math.max(...values),
    min: Math.min(...values),
    samples: history.length,
  };
}

function runtimeCoins(
  feature: unknown,
): Record<string, CoinFeatures> | undefined {
  const coins = (feature as RuntimeFeatures | undefined)?.coins;
  if (!coins || typeof coins !== "object" || Array.isArray(coins)) {
    return undefined;
  }
  return coins;
}

/**
 * Row model for the entry-feature preview: the BTC market anchor first, then
 * the trade's own coin (deduped when the trade IS BTC). Returns undefined when
 * the payload is not a feature store or carries no `priceNormalized` data —
 * callers then show nothing.
 */
export function summarizeFeaturePreview(
  feature: unknown,
  symbol: string,
): FeaturePreviewRow[] | undefined {
  const coins = runtimeCoins(feature);
  if (!coins) return undefined;

  const base = symbol.toUpperCase().replace(/_USDT$/, "");
  const keys = base === "BTC" ? ["BTC"] : ["BTC", base];
  const rows = keys.map((key) => ({
    bounds: historyBounds(coins[key]),
    coin: coins[key],
    key,
  }));
  return rows.some((row) => row.bounds !== undefined) ? rows : undefined;
}

function normColor(value: number): string {
  return value < 0 || value > 1 ? "warning.main" : "text.primary";
}

/**
 * Compact entry-feature preview for a trade row: the cloned `RuntimeFeatures`
 * snapshot captured at entry, distilled to one line per coin — BTC market
 * anchor plus the trade's own coin — showing `priceNormalized` at entry and
 * the `[min…max]` of its ~20-day history trail. Self-gating: renders nothing
 * when the stored feature payload carries no coin features (e.g. manual
 * entries or non-feature strategies).
 */
export default function TradeFeaturePreview({
  entryTimeMs,
  feature,
  symbol,
}: {
  entryTimeMs?: number;
  feature: unknown;
  symbol: string;
}) {
  const rows = summarizeFeaturePreview(feature, symbol);
  if (!rows) return null;

  return (
    <Box sx={{ mt: 0.75 }}>
      <Typography
        color="text.secondary"
        display="block"
        fontWeight={600}
        variant="caption"
      >
        priceNorm @ entry
      </Typography>
      {rows.map((row) => {
        const bounds = row.bounds;
        const trail =
          bounds !== undefined
            ? `${bounds.samples} trail samples` +
              (bounds.firstT !== undefined && bounds.lastT !== undefined
                ? ` · ${moment(bounds.firstT).format("DD MMM YYYY")} → ` +
                  moment(bounds.lastT).format("DD MMM YYYY")
                : "")
            : "";
        return (
          <Box
            key={row.key}
            title={
              trail
                ? `${row.key} priceNormalized min/max over ${trail}`
                : `${row.key} has no recorded priceNormalized trail`
            }
          >
            <Box sx={{ alignItems: "baseline", display: "flex", gap: 0.75 }}>
              <Typography
                color="text.secondary"
                component="span"
                sx={{ minWidth: 32 }}
                variant="caption"
              >
                {row.key}
              </Typography>
              <Typography
                color={
                  row.coin?.priceNormalized !== undefined
                    ? normColor(row.coin.priceNormalized)
                    : "text.secondary"
                }
                component="span"
                fontWeight={600}
                variant="caption"
              >
                {row.coin?.priceNormalized !== undefined
                  ? row.coin.priceNormalized.toFixed(3)
                  : "—"}
              </Typography>
              {bounds && (
                <Typography
                  color="text.secondary"
                  component="span"
                  variant="caption"
                >
                  [{bounds.min.toFixed(2)}…{bounds.max.toFixed(2)}] ×
                  {bounds.samples}
                </Typography>
              )}
            </Box>
            <PriceNormalizedHistorySparkline
              current={row.coin?.priceNormalized}
              entryTimeMs={entryTimeMs}
              history={row.coin?.priceNormalizedHistory}
            />
          </Box>
        );
      })}
    </Box>
  );
}
