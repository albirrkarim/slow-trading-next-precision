import type { VolatilityPoint } from "@/lib/system/types";

const MISSING_VOLATILITY_SYMBOL_LIMIT = 16;

/** Finds configured symbols that have no loaded volatility points. */
export function getMissingVolatilitySymbols({
  configuredSymbols,
  volatilityMap,
}: {
  configuredSymbols: string[];
  volatilityMap: Record<string, VolatilityPoint[]>;
}) {
  const symbolsWithVolatility = new Set(
    Object.entries(volatilityMap)
      .filter(([, points]) => points.length > 0)
      .map(([symbol]) => symbol.trim().toUpperCase()),
  );

  return configuredSymbols
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean)
    .filter((symbol, index, symbols) => symbols.indexOf(symbol) === index)
    .filter((symbol) => !symbolsWithVolatility.has(symbol))
    .sort((left, right) => left.localeCompare(right));
}

export function formatMissingVolatilitySymbols(symbols: string[]) {
  const visibleSymbols = symbols.slice(0, MISSING_VOLATILITY_SYMBOL_LIMIT);
  const hiddenCount = symbols.length - visibleSymbols.length;

  return [
    visibleSymbols.join(", "),
    hiddenCount > 0 ? `+${hiddenCount} more` : "",
  ]
    .filter(Boolean)
    .join(" ");
}
