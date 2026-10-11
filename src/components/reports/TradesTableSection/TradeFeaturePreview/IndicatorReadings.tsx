"use client";

import { Box, Typography } from "@mui/material";

import HintTooltip from "@/components/ui/HintTooltip";
import indicators, {
  GATE_VWAP_ID,
  type CoinEma,
  type CoinSupertrend,
  type CoinVwap,
  type FeatureIndicatorDefs,
} from "@/lib/features/indicators";
import type { CoinFeatures } from "@/lib/features/types";
import format from "@/lib/system/utils/format";

/** Signed pct with an explicit plus. */
function signedPct(value: number): string {
  return `${value > 0 ? "+" : ""}${value}%`;
}

function SupertrendReading({
  id,
  reading,
  label,
  entryTimeMs,
}: {
  id: string;
  reading: CoinSupertrend;
  label: string;
  entryTimeMs?: number;
}) {
  const up = reading.d === 1;
  const flipAgeMs =
    reading.fT !== undefined && entryTimeMs !== undefined
      ? entryTimeMs - reading.fT
      : undefined;
  return (
    <Box component="span" display="block">
      <HintTooltip title={`${label} — line ${reading.l}`}>
        <span>{id} </span>
      </HintTooltip>
      <Typography color={up ? "success.main" : "error.main"} component="span" variant="body1">
        {up ? "▲ up" : "▼ down"}
      </Typography>
      {reading.dPct !== undefined && ` · ${signedPct(reading.dPct)}`}
      {flipAgeMs !== undefined && flipAgeMs >= 0 && ` · flip ${format.duration(flipAgeMs)} ago`}
    </Box>
  );
}

function VwapReading({ id, reading, label }: { id: string; reading: CoinVwap; label: string }) {
  return (
    <Box component="span" display="block">
      <HintTooltip title={label}>
        <span>{id} </span>
      </HintTooltip>
      {reading.price !== undefined && `vwap ${reading.price}`}
      {reading.distancePct !== undefined && ` · ${signedPct(reading.distancePct)}`}
      {reading.dSigma !== undefined && ` · dσ ${reading.dSigma.toFixed(2)}`}
    </Box>
  );
}

function EmaReading({ id, reading, label }: { id: string; reading: CoinEma; label: string }) {
  return (
    <Box component="span" display="block">
      <HintTooltip title={label}>
        <span>{id} </span>
      </HintTooltip>
      {`ema ${reading.v}`}
      {reading.dPct !== undefined && ` · ${signedPct(reading.dPct)}`}
      {reading.sPct !== undefined && (
        <Typography
          color={reading.sPct > 0 ? "success.main" : reading.sPct < 0 ? "error.main" : undefined}
          component="span"
          variant="body1"
        >
          {` · slope ${signedPct(reading.sPct)}`}
        </Typography>
      )}
    </Box>
  );
}

/**
 * Captured dynamic indicator readings (`coin.ind`) other than the gates'
 * monthly VWAP, which the preview already renders in detail.
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
  const supertrends = Object.entries(coin?.ind?.supertrend ?? {});
  const vwaps = Object.entries(coin?.ind?.vwap ?? {}).filter(([id]) => id !== GATE_VWAP_ID);
  const emas = Object.entries(coin?.ind?.ema ?? {});
  if (supertrends.length === 0 && vwaps.length === 0 && emas.length === 0) return null;
  const label = (id: string) => {
    const def = defs?.[id];
    return def ? indicators.config.summary(def) : id;
  };
  return (
    <Typography color="text.secondary" component="div" sx={{ pl: "40px" }} variant="body1">
      {supertrends.map(([id, reading]) => (
        <SupertrendReading entryTimeMs={entryTimeMs} id={id} key={id} label={label(id)} reading={reading} />
      ))}
      {emas.map(([id, reading]) => (
        <EmaReading id={id} key={id} label={label(id)} reading={reading} />
      ))}
      {vwaps.map(([id, reading]) => (
        <VwapReading id={id} key={id} label={label(id)} reading={reading} />
      ))}
    </Typography>
  );
}
