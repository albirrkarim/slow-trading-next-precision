"use client";

import HintTooltip from "@/components/ui/HintTooltip";
import indicators, { GATE_VWAP_ID, type FeatureIndicatorDefs } from "@/lib/features/indicators";
import type { CoinFeatures } from "@/lib/features/types";
import format from "@/lib/system/utils/format";

import PreviewRow, { Item } from "./PreviewRow";
import { fmtPrice, signedPct } from "./VwapRow";

/** Signed-value color: green up, red down. */
function signColor(value: number | undefined): string | undefined {
  if (value === undefined || value === 0) return undefined;
  return value > 0 ? "success.main" : "error.main";
}

/**
 * Captured dynamic indicator readings (`coin.ind`) — one row per type,
 * one token per instance. The gates' monthly VWAP has its own row.
 */
export default function IndicatorReadings({
  coin,
  defs,
  entryTimeMs,
}: {
  coin?: CoinFeatures;
  defs?: FeatureIndicatorDefs;
  entryTimeMs?: number;
}) {
  const summary = (id: string) => {
    const def = defs?.[id];
    return def ? indicators.config.summary(def) : id;
  };
  const supertrends = Object.entries(coin?.ind?.supertrend ?? {});
  const emas = Object.entries(coin?.ind?.ema ?? {});
  const vwaps = Object.entries(coin?.ind?.vwap ?? {}).filter(([id]) => id !== GATE_VWAP_ID);

  return (
    <>
      {supertrends.length > 0 && (
        <PreviewRow label="ST">
          {supertrends.map(([id, reading]) => {
            const up = reading.d === 1;
            const flipAgeMs =
              reading.fT !== undefined && entryTimeMs !== undefined ? entryTimeMs - reading.fT : undefined;
            return (
              <HintTooltip
                key={id}
                title={
                  `${id}: ${summary(id)} — ${up ? "uptrend" : "downtrend"}, line ${reading.l}` +
                  (reading.dPct !== undefined ? `, mark ${signedPct(reading.dPct)} from the line` : "") +
                  (flipAgeMs !== undefined && flipAgeMs >= 0 ? `, flipped ${format.duration(flipAgeMs)} before entry` : "")
                }
              >
                <Item color={up ? "success.main" : "error.main"}>
                  {id} {up ? "▲" : "▼"}
                  {flipAgeMs !== undefined && flipAgeMs >= 0 && ` ${format.duration(flipAgeMs)}`}
                </Item>
              </HintTooltip>
            );
          })}
        </PreviewRow>
      )}
      {emas.map(([id, reading]) => (
        <PreviewRow key={id} label="EMA">
          <HintTooltip title={`${id}: ${summary(id)}`}>
            <Item>
              {id} {fmtPrice(reading.v)}
            </Item>
          </HintTooltip>
          {reading.dPct !== undefined && (
            <HintTooltip title="Mark price's distance from the EMA">
              <Item>{signedPct(reading.dPct)}</Item>
            </HintTooltip>
          )}
          {reading.sPct !== undefined && (
            <HintTooltip title="Last candle's EMA change — the slope">
              <Item color={signColor(reading.sPct)}>slope {signedPct(reading.sPct)}</Item>
            </HintTooltip>
          )}
        </PreviewRow>
      ))}
      {vwaps.map(([id, reading]) => (
        <PreviewRow key={id} label="VWAP">
          <HintTooltip title={`${id}: ${summary(id)}`}>
            <Item>
              {id} {reading.price !== undefined ? fmtPrice(reading.price) : "—"}
            </Item>
          </HintTooltip>
          {reading.distancePct !== undefined && <Item>{signedPct(reading.distancePct)}</Item>}
          {reading.dSigma !== undefined && <Item>dσ {reading.dSigma.toFixed(2)}</Item>}
        </PreviewRow>
      ))}
    </>
  );
}
