import type { VolatilityPoint } from "./volatility";

export interface DynamicTradeMemorySimple {}

/**
 * Crop because we havent seen the next volatility points
 * @param currentTimeMs
 * @param volatilityMap
 */
export function cropVolatility(
  currentTimeMs: number,
  volatilityMap: Record<string, VolatilityPoint[]>,
  startTimeMs?: number,
  includeCurrentPoint = false,
): Record<string, VolatilityPoint[]> {
  const newVMap: Record<string, VolatilityPoint[]> = {};

  for (const symbol of Object.keys(volatilityMap)) {
    const points = volatilityMap[symbol];

    let filtered = points.filter((p) =>
      includeCurrentPoint ? p.t <= currentTimeMs : p.t < currentTimeMs,
    );

    if (startTimeMs) {
      filtered = filtered.filter((p) => p.t >= startTimeMs);
    }

    // Keep only last 100 points to avoid memory bloat
    newVMap[symbol] = filtered.slice(-100);
  }

  return {
    ...newVMap,
  };
}
