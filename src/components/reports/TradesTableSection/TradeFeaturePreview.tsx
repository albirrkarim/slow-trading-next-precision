"use client";

import { Box, Typography } from "@mui/material";
import moment from "moment";

import { PriceNormalizedHistorySparkline } from "@/components/charts/PriceNormalizedHistorySparkline";
import type {
  CoinFeatures,
  CoinPriceNormalized,
  CoinVwap,
  FeatureHistoryPoint,
  RuntimeFeatures,
} from "@/lib/features/types";
import { FEATURE_GATE_VWAP_BOUNDS } from "@/lib/strategies/default_with_features_gate/feature_gate_v2";

export interface FeaturePreviewRow {
  /** Min/max/span over the coin's `priceNormalized.history` plus its current value. */
  bounds?: {
    firstT?: number;
    lastT?: number;
    max: number;
    min: number;
    samples: number;
  };
  coin?: CoinFeatures;
  key: string;
  /**
   * The trade's own coin row — the other row is the BTC market-anchor
   * readout. Readouts that judge the entry signal (dσ) only render here.
   */
  own?: boolean;
}

/**
 * Current `priceNormalized` reading across store shapes — grouped
 * `{current}` now, a flat number on feature snapshots recorded before the
 * group existed.
 */
function priceNormCurrent(
  coin: CoinFeatures | undefined,
): number | undefined {
  const raw = coin?.priceNormalized as
    | CoinPriceNormalized
    | number
    | undefined;
  return typeof raw === "number" ? raw : raw?.current;
}

/**
 * `priceNormalized` trail across store shapes — grouped `history` now,
 * flat `priceNormalizedHistory` on snapshots recorded before the group
 * existed.
 */
function priceNormHistory(
  coin: CoinFeatures | undefined,
): FeatureHistoryPoint[] {
  const raw = coin?.priceNormalized as
    | CoinPriceNormalized
    | number
    | undefined;
  const grouped = typeof raw === "number" ? undefined : raw?.history;
  const history = Array.isArray(grouped)
    ? grouped
    : coin?.priceNormalizedHistory;
  return Array.isArray(history) ? history : [];
}

/**
 * `vwap` group across store shapes — the `{price, stdev, …}` group now,
 * flat `vwap*` fields on snapshots recorded before the group existed.
 */
function coinVwap(coin: CoinFeatures | undefined): CoinVwap | undefined {
  const raw = coin?.vwap as CoinVwap | number | undefined;
  if (typeof raw === "number") {
    return {
      anchorT: coin?.vwapAnchorT,
      distancePct: coin?.vwapDistancePct,
      price: raw,
      stdev: coin?.vwapStdev,
      stretchPct: coin?.vwapStretchPct,
    };
  }
  return raw;
}

/**
 * σ-distance of a signal price from the monthly VWAP — the same
 * `|signal − vwap| / σ` reading `feature_gate_v2` enforces inside
 * `[minSigma, maxSigma]`. Returns undefined unless every input is a
 * finite number and σ > 0.
 */
export function vwapSigmaDistance(
  signalPrice?: number,
  vwap?: number,
  stdev?: number,
): number | undefined {
  if (
    typeof signalPrice !== "number" ||
    !Number.isFinite(signalPrice) ||
    typeof vwap !== "number" ||
    !Number.isFinite(vwap) ||
    typeof stdev !== "number" ||
    !Number.isFinite(stdev) ||
    stdev <= 0
  ) {
    return undefined;
  }
  return Math.abs(signalPrice - vwap) / stdev;
}

function historyBounds(
  coin: CoinFeatures | undefined,
): FeaturePreviewRow["bounds"] {
  const history = priceNormHistory(coin).filter(
    (point) =>
      Number.isFinite(point?.p) && Number.isFinite(point?.t),
  );
  const values = history.map((point) => point.p);
  const current = priceNormCurrent(coin);
  if (current !== undefined) {
    values.push(current);
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
    own: key === base,
  }));
  return rows.some((row) => row.bounds !== undefined) ? rows : undefined;
}

function normColor(value: number): string {
  return value < 0 || value > 1 ? "warning.main" : "text.primary";
}

/** Compact price-scale formatter: BTC-scale values collapse, sub-1 keeps sig figs. */
function fmtPrice(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1000) return value.toFixed(0);
  if (abs >= 10) return value.toFixed(1);
  if (abs >= 1) return value.toFixed(2);
  return value.toPrecision(4);
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
        const current = priceNormCurrent(row.coin);
        const vwap = coinVwap(row.coin);
        // The trade's own row only: σ-distance of the entry-time signal
        // point from the monthly VWAP — same dσ the vwap gate enforces.
        const dSigma =
          row.own === true
            ? vwapSigmaDistance(
                row.coin?.latestVpoint?.p,
                vwap?.price,
                vwap?.stdev,
              )
            : undefined;
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
                  current !== undefined
                    ? normColor(current)
                    : "text.secondary"
                }
                component="span"
                fontWeight={600}
                variant="caption"
              >
                {current !== undefined ? current.toFixed(3) : "—"}
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
            {vwap?.price !== undefined && (
              <Typography
                color="text.secondary"
                component="span"
                display="block"
                sx={{ pl: "40px" }}
                title={
                  `Monthly-anchored VWAP at entry — σ = population stdev of ` +
                  `typical price since the month boundary, dist = mark vs ` +
                  `VWAP, env = ±2σ envelope width, dσ = entry signal's ` +
                  `distance from VWAP in σ — green inside the gate's ` +
                  `[${FEATURE_GATE_VWAP_BOUNDS.minSigma}, ` +
                  `${FEATURE_GATE_VWAP_BOUNDS.maxSigma}]σ zone`
                }
                variant="caption"
              >
                vwap {fmtPrice(vwap.price)}
                {vwap.stdev !== undefined &&
                  ` · σ ${fmtPrice(vwap.stdev)}`}
                {vwap.distancePct !== undefined &&
                  ` · ${vwap.distancePct > 0 ? "+" : ""}` +
                    `${vwap.distancePct}%`}
                {vwap.stretchPct !== undefined &&
                  ` · env ${vwap.stretchPct}%`}
                {dSigma !== undefined && (
                  <Typography
                    color={
                      dSigma >= FEATURE_GATE_VWAP_BOUNDS.minSigma &&
                      dSigma <= FEATURE_GATE_VWAP_BOUNDS.maxSigma
                        ? "success.main"
                        : "text.secondary"
                    }
                    component="span"
                    variant="caption"
                  >
                    {` · dσ ${dSigma.toFixed(2)}`}
                  </Typography>
                )}
              </Typography>
            )}
            <PriceNormalizedHistorySparkline
              current={current}
              entryTimeMs={entryTimeMs}
              history={priceNormHistory(row.coin)}
            />
          </Box>
        );
      })}
    </Box>
  );
}
