import type {
  CoinFeatures,
  CoinPriceNormalized,
  FeatureHistoryPoint,
  RuntimeFeatures,
} from "@/lib/features/types";

export interface FeaturePreviewRow {
  /** Min/max over the trail plus current; average over recorded trail samples only. */
  bounds?: {
    avg?: number;
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
export function priceNormCurrent(
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
export function priceNormHistory(
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

/** Summarizes finite recorded priceNorm points; the current reading only extends min/max. */
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
    avg: history.length > 0
      ? history.reduce((sum, point) => sum + point.p, 0) / history.length
      : undefined,
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
