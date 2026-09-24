import { runtimeStorage } from "@/lib/system/storage";
import type { ExchangeType, VolatilityPoint } from "@/lib/system/types";

/**
 * Atomically merges vPoints into one symbol's persisted volatility file at
 * `prod/volatility/<exchangeType>/<symbol>.json`.
 *
 * Points are merged by `id`: the full detected history already on disk is
 * preserved while runtime-only mutations — `usedBy` markers and
 * newly detected points — are written through. Passing a single-point array
 * persists one point; passing the retained runtime window flushes markers.
 */
async function persistPoints(params: {
  exchangeType: ExchangeType;
  symbol: string;
  points: VolatilityPoint[];
}): Promise<void> {
  await runtimeStorage.vpoints.merge({
    exchangeType: params.exchangeType,
    symbol: params.symbol,
    points: params.points,
  });
}

/** Grouped production vPoint persistence operations. */
const vpointFiles = {
  persistPoints,
};

export default vpointFiles;
