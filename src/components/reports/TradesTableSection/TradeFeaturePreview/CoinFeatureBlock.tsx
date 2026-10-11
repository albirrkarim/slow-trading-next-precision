"use client";

import { Box, Typography } from "@mui/material";
import moment from "moment";

import { PriceNormalizedHistorySparkline } from "@/components/charts/PriceNormalizedHistorySparkline";
import HintTooltip from "@/components/ui/HintTooltip";
import indicators, { type FeatureIndicatorDefs } from "@/lib/features/indicators";
import priceNorm from "@/lib/features/price-norm";
import { FEATURE_GATE_VWAP_BOUNDS } from "@/lib/strategies/default_with_features_gate/features/v2/feature_gate_v2";
import type { VolatilityPoint } from "@/lib/system/types/market";
import format from "@/lib/system/utils/format";

import { priceNormCurrent, priceNormHistory, type FeaturePreviewRow } from "./data";
import IndicatorReadings from "./IndicatorReadings";
import PreviewRow, { Item } from "./PreviewRow";
import VwapRow from "./VwapRow";

/** Out-of-envelope readings (breakouts) stand out. */
function normColor(value: number): string {
  return value < 0 || value > 1 ? "warning.main" : "text.primary";
}

/** Marks a clear trend in either direction once its magnitude exceeds 0.5. */
function trendColor(value: number): string {
  return Math.abs(value) > 0.5 ? "warning.main" : "success.main";
}

/** Separates inverse, weak, and matching BTC movement without implying a trade decision. */
function correlationColor(value: number | undefined): string {
  if (value === undefined) return "text.secondary";
  if (value < 1 / 3) return "warning.main";
  if (value > 2 / 3) return "success.main";
  return "text.secondary";
}

/** One coin's entry features: a header, one labeled row per topic, the trail sparkline. */
export default function CoinFeatureBlock({
  row,
  correlation,
  defs,
  entryTimeMs,
  signal,
}: {
  row: FeaturePreviewRow;
  /** BTC ↔ coin movement correlation — own non-BTC coin only. */
  correlation?: number;
  defs?: FeatureIndicatorDefs;
  entryTimeMs?: number;
  signal?: VolatilityPoint;
}) {
  const { bounds, coin } = row;
  const current = priceNormCurrent(coin);
  const history = priceNormHistory(coin);
  const exhaustion = priceNorm.exhaustion.score(history);
  const suddenChange = (history.at(-1)?.p ?? 0) - (history.at(-2)?.p ?? 0);
  // Stamped by the feature update — absent on snapshots recorded before it existed.
  const trend = coin?.priceNormalized?.trend;
  const vwap = indicators.read.vwap(coin);
  const vPoint = row.own ? (signal ?? coin?.latestVpoint) : coin?.latestVpoint;
  const vPointAgeMs =
    row.own && Number.isFinite(vPoint?.t) && entryTimeMs !== undefined && Number.isFinite(entryTimeMs)
      ? entryTimeMs - (vPoint?.t as number)
      : undefined;
  const trail = bounds
    ? `${bounds.samples} trail samples` +
      (bounds.firstT !== undefined && bounds.lastT !== undefined
        ? ` · ${moment(bounds.firstT).format("DD MMM YYYY")} → ${moment(bounds.lastT).format("DD MMM YYYY")}`
        : "")
    : "";

  return (
    <Box sx={{ borderTop: 1, borderColor: "divider", display: "grid", gap: 0.25, pt: 0.75 }}>
      <Box sx={{ alignItems: "baseline", display: "flex", gap: 1 }}>
        <Typography component="span" fontWeight={700} sx={{ width: 48 }} variant="body2">
          {row.key}
        </Typography>
        <HintTooltip title="priceNormalized at entry — the latest pivot's position inside the trailing pivot envelope (0 = floor, 1 = top; outside = breakout)">
          <Typography
            color={current !== undefined ? normColor(current) : "text.secondary"}
            component="span"
            fontWeight={700}
            variant="body2"
          >
            {current !== undefined ? current.toFixed(3) : "—"}
          </Typography>
        </HintTooltip>
      </Box>

      {bounds && (
        <PreviewRow label="Range">
          <HintTooltip title={`priceNormalized min/max over ${trail}`}>
            <Item>
              {bounds.min.toFixed(2)}–{bounds.max.toFixed(2)}
            </Item>
          </HintTooltip>
          {bounds.avg !== undefined && (
            <HintTooltip title="Mean of the recorded priceNormalized history; the current reading is not added again">
              <Item>avg {bounds.avg.toFixed(2)}</Item>
            </HintTooltip>
          )}
          <Item color="text.secondary">{bounds.samples} pts</Item>
        </PreviewRow>
      )}

      {(trend !== undefined || correlation !== undefined || (row.own && row.key !== "BTC")) && (
        <PreviewRow label="Norm">
          {trend !== undefined && (
            <HintTooltip title="priceNormalized trail trend clarity, −1…+1 (efficiency ratio): green −0.5…+0.5 is sideways, orange outside is clearly trending">
              <Item color={trendColor(trend)}>
                trend {trend > 0 ? "+" : ""}
                {trend.toFixed(2)}
              </Item>
            </HintTooltip>
          )}
          {row.own && row.key !== "BTC" && (
            <HintTooltip title="BTC/coin priceNorm movement correlation: below 0.33 opposite (orange), 0.33–0.67 weak (muted), above 0.67 together (green). A dash means too little overlap.">
              <Item color={correlationColor(correlation)}>
                corr BTC {correlation === undefined ? "—" : correlation.toFixed(2)}
              </Item>
            </HintTooltip>
          )}
        </PreviewRow>
      )}

      {vwap && <VwapRow showDSigma={row.own === true} vwap={vwap} />}

      <IndicatorReadings coin={coin} defs={defs} entryTimeMs={entryTimeMs} />

      {vPointAgeMs !== undefined && (
        <PreviewRow label="Signal">
          <HintTooltip title={`Time from the signal vPoint (${vPoint?.id}) forming to the entry fill`}>
            <Item color={vPointAgeMs > FEATURE_GATE_VWAP_BOUNDS.maxSignalAgeMs ? "warning.main" : undefined}>
              vPoint → entry {format.duration(vPointAgeMs)}
            </Item>
          </HintTooltip>
        </PreviewRow>
      )}

      <PreviewRow label="Scores">
        <HintTooltip title="Research score, 0–1: a stalled priceNorm extreme, an early turn, or a range breaking away from repeatedly tested highs or lows. A dash means the trail is too short; not an entry rule.">
          <Item color={exhaustion !== undefined && exhaustion > 0.5 ? "warning.main" : undefined}>
            exhaustion {exhaustion === undefined ? "—" : exhaustion.toFixed(2)}
          </Item>
        </HintTooltip>
        <HintTooltip title="Last priceNormalized step — the newest trail change">
          <Item color={Math.abs(suddenChange) > 0.2 ? "warning.main" : undefined}>
            sudden {suddenChange.toFixed(2)}
          </Item>
        </HintTooltip>
      </PreviewRow>

      <PriceNormalizedHistorySparkline current={current} entryTimeMs={entryTimeMs} history={history} />
    </Box>
  );
}
