import type { CoinPriceNormalized } from "@/lib/features/types";
import type { RuntimeContext } from "@/lib/precision/types";
import type { VolatilityPoint } from "@/lib/system/types/market";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Experimental bounds fitted to entry snapshots; full replay is required. */
export const FEATURE_GATE_REGIME_BOUNDS = {
  minBreakoutNormalized: 1.1,
  maxFailedBreakoutNormalized: 0.85,
  minSpentReboundUpPct: 3.5,
  maxWeakBtcNormalized: 0.1,
  maxBreakdownBtcStretchPct: 10,
  maxQuietBtcStretchPct: 4,
  minQuietCoinNormalized: 0.05,
  maxQuietCoinNormalized: 0.95,
};

/** Reads the visible normalized trail without assigning values to missing data. */
function readTrail(group: CoinPriceNormalized | undefined, now: number) {
  const current = group?.current;
  const history = (group?.history ?? []).filter(
    (point) =>
      Number.isFinite(point.p) && Number.isFinite(point.t) && point.t <= now,
  );
  const recent = history.filter((point) => point.t >= now - DAY_MS);
  return {
    current:
      typeof current === "number" && Number.isFinite(current)
        ? current
        : undefined,
    minDay: recent.length
      ? Math.min(...recent.map((point) => point.p))
      : undefined,
    maxLastThree: history.length
      ? Math.max(...history.slice(-3).map((point) => point.p))
      : undefined,
    minLastThree: history.length
      ? Math.min(...history.slice(-3).map((point) => point.p))
      : undefined,
  };
}

/** Rejects failed breakouts, spent rebounds and extreme ranges with weak BTC support. */
export default function featureGateRegimes(
  context: RuntimeContext,
  symbol: string,
  signal: VolatilityPoint,
): string | undefined {
  // BOTH:FEATURE_GATE_REGIMES — no environment adapter or future prices.
  const bounds = FEATURE_GATE_REGIME_BOUNDS;
  const now = context.state.currentTime;
  const coins = context.state.features?.coins;
  const coin = readTrail(coins?.[symbol.toUpperCase()]?.priceNormalized, now);
  const btc = readTrail(coins?.BTC?.priceNormalized, now);
  const upPct = signal.maxUpPct;

  if (
    coin.maxLastThree !== undefined &&
    coin.maxLastThree > bounds.minBreakoutNormalized &&
    coin.current !== undefined &&
    coin.current <= bounds.maxFailedBreakoutNormalized
  ) {
    return "reject entry - recent breakout failed back into the prior range";
  }

  if (
    typeof upPct === "number" && Number.isFinite(upPct) &&
    upPct > bounds.minSpentReboundUpPct &&
    btc.minLastThree !== undefined &&
    btc.minLastThree <= bounds.maxWeakBtcNormalized
  ) {
    return "reject entry - rebound already spent while BTC is near its range floor";
  }

  const btcStretchPct = coins?.BTC?.vwap?.stretchPct;
  if (
    typeof btcStretchPct === "number" && Number.isFinite(btcStretchPct) &&
    btcStretchPct <= bounds.maxBreakdownBtcStretchPct &&
    coin.minDay !== undefined && coin.minDay <= 0
  ) {
    return "reject entry - recent range breakdown without a wide BTC VWAP envelope";
  }

  if (
    typeof btcStretchPct === "number" && Number.isFinite(btcStretchPct) &&
    btcStretchPct <= bounds.maxQuietBtcStretchPct &&
    coin.current !== undefined &&
    (coin.current <= bounds.minQuietCoinNormalized ||
      coin.current > bounds.maxQuietCoinNormalized)
  ) {
    return "reject entry - coin is at a range extreme while BTC volatility is quiet";
  }

  return undefined;
}
