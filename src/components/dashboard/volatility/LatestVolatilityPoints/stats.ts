import type { VolatilityPoint } from "@/lib/system/types";
import type { VolatilityPointLabelFrequency } from "./types";

/** Counts vPoints by volatility level for the loaded dashboard range. */
export function countVolatilityLevels(points: VolatilityPoint[]) {
  return points.reduce<Record<string, number>>((frequency, point) => {
    if (!Number.isFinite(point.lvl)) return frequency;
    const key = String(point.lvl);
    frequency[key] = (frequency[key] ?? 0) + 1;
    return frequency;
  }, {});
}

/** Calculates TOP/DOWN vPoint share for the loaded dashboard range. */
export function countVolatilityPointLabels(
  points: VolatilityPoint[],
): VolatilityPointLabelFrequency {
  let downCount = 0;
  let topCount = 0;

  for (const point of points) {
    if (point.l === "T") topCount += 1;
    if (point.l === "B") downCount += 1;
  }

  const total = topCount + downCount;

  return {
    downCount,
    downPct: total > 0 ? (downCount / total) * 100 : 0,
    topCount,
    topPct: total > 0 ? (topCount / total) * 100 : 0,
  };
}

/** Counts TOP/DOWN vPoint share across configured coins in the dashboard range. */
export function countConfiguredVolatilityPointLabels({
  configuredSymbols,
  volatilityMap,
}: {
  configuredSymbols: Iterable<string>;
  volatilityMap: Record<string, VolatilityPoint[]>;
}) {
  const configuredSymbolSet = new Set(
    Array.from(configuredSymbols, (symbol) => symbol.trim().toUpperCase()),
  );

  return countVolatilityPointLabels(
    Object.entries(volatilityMap).flatMap(([symbol, points]) =>
      configuredSymbolSet.has(symbol.trim().toUpperCase()) ? points : [],
    ),
  );
}
