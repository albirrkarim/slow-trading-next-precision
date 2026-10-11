"use client";

import HintTooltip from "@/components/ui/HintTooltip";
import type { CoinVwap } from "@/lib/features/indicators";
import { FEATURE_GATE_VWAP_BOUNDS } from "@/lib/strategies/default_with_features_gate/features/v2/feature_gate_v2";

import PreviewRow, { Item } from "./PreviewRow";

/** Compact price-scale formatter: BTC-scale values collapse, sub-1 keeps sig figs. */
export function fmtPrice(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1000) return value.toFixed(0);
  if (abs >= 10) return value.toFixed(1);
  if (abs >= 1) return value.toFixed(2);
  return value.toPrecision(4);
}

/** Signed pct with an explicit plus. */
export function signedPct(value: number): string {
  return `${value > 0 ? "+" : ""}${value}%`;
}

/** Colors VWAP distance by its magnitude, regardless of direction. */
function distanceColor(value: number): string {
  const distance = Math.abs(value);
  if (distance < 5) return "success.main";
  if (distance < 10) return "warning.main";
  return "error.main";
}

/** Green inside the gate's σ zone, orange below it, red above it. */
function dSigmaColor(value: number): string {
  if (value > FEATURE_GATE_VWAP_BOUNDS.maxSigma) return "error.main";
  return value >= FEATURE_GATE_VWAP_BOUNDS.minSigma ? "success.main" : "warning.main";
}

/** The gates' monthly VWAP at entry; `dSigma` only on the trade's own coin. */
export default function VwapRow({ vwap, showDSigma }: { vwap: CoinVwap; showDSigma: boolean }) {
  if (vwap.price === undefined) return null;
  return (
    <PreviewRow label="VWAP">
      <HintTooltip title="Monthly-anchored VWAP at entry — volume-weighted average of typical price since the UTC month boundary">
        <Item>{fmtPrice(vwap.price)}</Item>
      </HintTooltip>
      {vwap.stdev !== undefined && (
        <HintTooltip title="σ — population standard deviation of typical price since the month boundary; the VWAP envelope's unit of width">
          <Item>σ {fmtPrice(vwap.stdev)}</Item>
        </HintTooltip>
      )}
      {vwap.distancePct !== undefined && (
        <HintTooltip title="Mark price's distance from the monthly VWAP — negative means below the month-to-date mean; under 5% green, under 10% orange, otherwise red">
          <Item color={distanceColor(vwap.distancePct)}>{signedPct(vwap.distancePct)}</Item>
        </HintTooltip>
      )}
      {vwap.stretchPct !== undefined && (
        <HintTooltip
          title={`±2σ envelope width as % of VWAP — the gate rejects entries below ${FEATURE_GATE_VWAP_BOUNDS.minStretchPct}% (wave too narrow to mean-revert)`}
        >
          <Item>env {vwap.stretchPct}%</Item>
        </HintTooltip>
      )}
      {showDSigma && vwap.dSigma !== undefined && (
        <HintTooltip
          title={`Entry signal's distance from the monthly VWAP in σ — green inside the gate's [${FEATURE_GATE_VWAP_BOUNDS.minSigma}, ${FEATURE_GATE_VWAP_BOUNDS.maxSigma}]σ zone; orange below it and red above it`}
        >
          <Item color={dSigmaColor(vwap.dSigma)}>dσ {vwap.dSigma.toFixed(2)}</Item>
        </HintTooltip>
      )}
    </PreviewRow>
  );
}
