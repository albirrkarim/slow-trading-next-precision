import indicators from "@/lib/features/indicators";
import type { RuntimeFeatures } from "@/lib/features/types";
import type { VolatilityPoint } from "@/lib/system/types/market";

/**
 * Trend direction the signal trades: a TOP (`l: "T"`) opens a short, so it
 * needs a downtrend (-1); a BOTTOM opens a long and needs an uptrend (1).
 */
function wantedDirection(signal: VolatilityPoint): 1 | -1 {
  return signal.l === "T" ? -1 : 1;
}

/**
 * Rejection reason unless every captured Supertrend of the signal's coin
 * confirms the trade direction. Fails closed: with no Supertrend reading
 * (none configured, or still warming up) there is nothing to confirm.
 */
function supertrendRejection(
  features: RuntimeFeatures | undefined,
  signal: VolatilityPoint,
): string | undefined {
  const symbol = (signal.symbol ?? "").toUpperCase().replace(/_USDT$/, "");
  const readings = Object.entries(features?.coins[symbol]?.ind?.supertrend ?? {});
  const side = signal.l === "T" ? "short" : "long";
  if (readings.length === 0) {
    return `v6 supertrend: no Supertrend reading to confirm the ${side}`;
  }
  const wanted = wantedDirection(signal);
  const against = readings.filter(([, reading]) => reading.d !== wanted);
  if (against.length === 0) return undefined;
  const ids = against.map(([id]) => id).join(", ");
  const definitions = features?.defs;
  const detail = against
    .map(([id]) => definitions?.[id] && indicators.config.summary(definitions[id]))
    .filter(Boolean)
    .join("; ");
  return (
    `v6 supertrend: ${ids} ${against.length === 1 ? "is" : "are"} ` +
    `${wanted === -1 ? "up" : "down"}, ${side} needs every Supertrend ` +
    `${wanted === -1 ? "down" : "up"}${detail ? ` (${detail})` : ""}`
  );
}

const v6Supertrend = { rejection: supertrendRejection, wantedDirection } as const;

export default v6Supertrend;
