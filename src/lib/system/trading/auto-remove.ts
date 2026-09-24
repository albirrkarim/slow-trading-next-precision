import type { VolatilityPoint } from "../types";

/** Normalizes a configured coin symbol; trading-pair suffixes are stripped. */
function normalizeSymbol(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/_USDT$/, "");
}

/** Dedupes a configured symbol list after normalization, preserving order. */
function uniqueConfiguredSymbols(symbols: string[]): string[] {
  return Array.from(
    new Set(symbols.map(normalizeSymbol).filter(Boolean)),
  );
}

/** Absolute level of a symbol's latest persisted vPoint; 0 when unavailable. */
function latestAbsLevel(points: VolatilityPoint[] | undefined): number {
  const level = Number(points?.at(-1)?.lvl ?? 0);
  return Number.isFinite(level) ? Math.abs(level) : 0;
}

/**
 * Finds configured symbols whose latest persisted vPoint reached the
 * configured absolute level; a non-positive threshold disables the rule.
 */
function findByAbsLevel(params: {
  configuredSymbols: string[];
  thresholdAbsLevel: unknown;
  volatilityPointsBySymbol: Record<string, VolatilityPoint[]>;
}): string[] {
  const thresholdAbsLevel = Math.floor(Number(params.thresholdAbsLevel));
  if (!Number.isFinite(thresholdAbsLevel) || thresholdAbsLevel <= 0) {
    return [];
  }

  return uniqueConfiguredSymbols(params.configuredSymbols).filter(
    (symbol) =>
      latestAbsLevel(params.volatilityPointsBySymbol[symbol]) >=
      thresholdAbsLevel,
  );
}

/**
 * Returns whether a valid market price is strictly below the enabled
 * minimum. Missing or invalid prices are never below the minimum.
 */
function isPriceBelowMinimum(params: {
  minimumPrice: unknown;
  price: unknown;
}): boolean {
  const price = Number(params.price);
  const minimumPrice = Number(params.minimumPrice);

  return (
    Number.isFinite(price) &&
    price > 0 &&
    Number.isFinite(minimumPrice) &&
    minimumPrice > 0 &&
    price < minimumPrice
  );
}

/** Finds configured symbols whose latest valid market price is below the minimum. */
function findByMinPrice(params: {
  configuredSymbols: string[];
  latestPriceBySymbol: Record<string, number>;
  minimumPrice: number;
}): string[] {
  return uniqueConfiguredSymbols(params.configuredSymbols).filter((symbol) =>
    isPriceBelowMinimum({
      minimumPrice: params.minimumPrice,
      price: params.latestPriceBySymbol[symbol],
    }),
  );
}

/** Finds configured symbols below the enabled minimum USD market cap. */
function findByMarketCap(params: {
  configuredSymbols: string[];
  marketCapUSDBySymbol: Record<string, number>;
  minimumMarketCapUSD: number;
}): string[] {
  const minimumMarketCapUSD = Number(params.minimumMarketCapUSD);
  if (!Number.isFinite(minimumMarketCapUSD) || minimumMarketCapUSD <= 0) {
    return [];
  }

  return uniqueConfiguredSymbols(params.configuredSymbols).filter(
    (symbol) => {
      const marketCapUSD = Number(params.marketCapUSDBySymbol[symbol]);
      return (
        Number.isFinite(marketCapUSD) &&
        marketCapUSD > 0 &&
        marketCapUSD < minimumMarketCapUSD
      );
    },
  );
}

/** Returns the stored vPoint with the greatest valid movement percentage. */
function findHighestVPointPct(
  points: VolatilityPoint[],
): VolatilityPoint | undefined {
  return points.reduce<VolatilityPoint | undefined>((highest, point) => {
    const pct = Number(point.pct);
    if (!Number.isFinite(pct)) {
      return highest;
    }
    if (!highest || pct > Number(highest.pct)) {
      return point;
    }
    return highest;
  }, undefined);
}

/** Finds symbols when any vPoint in their complete stored history meets the threshold. */
function findByVPointPct(params: {
  configuredSymbols: string[];
  minimumVPointPct: number;
  volatilityPointsBySymbol: Record<string, VolatilityPoint[]>;
}): string[] {
  const minimumVPointPct = Number(params.minimumVPointPct);
  if (!Number.isFinite(minimumVPointPct) || minimumVPointPct <= 0) {
    return [];
  }

  return uniqueConfiguredSymbols(params.configuredSymbols).filter(
    (symbol) => {
      const highest = findHighestVPointPct(
        params.volatilityPointsBySymbol[symbol] ?? [],
      );
      return Boolean(highest && highest.pct >= minimumVPointPct);
    },
  );
}

/**
 * Removes symbols from a configured list while preserving the original order.
 */
function removeFromConfig(
  configuredSymbols: string[],
  symbolsToRemove: string[],
): string[] {
  const removeSet = new Set(symbolsToRemove.map(normalizeSymbol));

  return uniqueConfiguredSymbols(configuredSymbols).filter(
    (symbol) => !removeSet.has(symbol),
  );
}

/** Grouped coin auto-removal rule helpers shared by the runtime layers. */
const autoRemove = {
  find: {
    byAbsLevel: findByAbsLevel,
    byMarketCap: findByMarketCap,
    byMinPrice: findByMinPrice,
    byVPointPct: findByVPointPct,
  },
  price: {
    isBelowMinimum: isPriceBelowMinimum,
  },
  remove: {
    fromConfig: removeFromConfig,
  },
  symbol: {
    normalize: normalizeSymbol,
  },
  vPoint: {
    findHighestPct: findHighestVPointPct,
  },
} as const;

export default autoRemove;
export { autoRemove };
