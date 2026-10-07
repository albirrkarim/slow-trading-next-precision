import type { CoinFeatures, RuntimeFeatures } from "@/lib/features/types";
import type { VolatilityPoint } from "@/lib/system/types/market";

import directional from "./directional";

const fields = ["signal.tradeMeanDeviation", "btc.tradeMeanDeviation", "relative.quoteVolume", "btc.maxUpPct", "btc.maxDownPct",
  "btc.excursionAlignment", "signal.excursionAlignment", "coin.markDrift", "btc.markDrift", "coin.anchorLogHours",
  "btc.anchorLogHours", "month.logHoursRemaining", "coin.sigmaWaveRatio", "btc.sigmaWaveRatio", "signal.vwapWaveDistance",
  "relative.pivotLogGapHours", "btc.directionalLevel", "relative.logWaveRatio"];
const names = [...directional.names, ...fields];

/** Preserves missing observations rather than inventing a zero. */
function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Converts the captured VWAP context to scale-independent price/volatility observations. */
function context(coin: CoinFeatures | undefined, t: number) {
  const price = finite(coin?.vwap?.price), sigma = finite(coin?.vwap?.stdev);
  const distance = finite(coin?.vwap?.distancePct), anchor = finite(coin?.vwap?.anchorT);
  return {
    mark: price !== undefined && price > 0 && distance !== undefined ? price * (1 + distance / 100) : undefined,
    sigmaPct: price !== undefined && price > 0 && sigma !== undefined && sigma > 0 ? sigma / price * 100 : undefined,
    anchorHours: anchor !== undefined && anchor <= t ? Math.log1p((t - anchor) / 3_600_000) : undefined,
  };
}

/** Reads confirmation-volume geometry, observed BTC movement and calendar-anchor physics from the frozen capture only. */
function read(t: number, features: RuntimeFeatures | undefined, signal: VolatilityPoint): Array<number | undefined> {
  const side = signal.l === "B" ? -1 : 1;
  const symbol = (signal.symbol ?? "").toUpperCase().replace(/_USDT$/, "");
  const own = features?.coins[symbol], btc = features?.coins.BTC;
  const point = btc?.latestVpoint;
  const observed = point && Number.isFinite(point.t) && point.t <= t ? point : undefined;
  const coin = context(own, t), anchor = context(btc, t);
  const up = finite(observed?.maxUpPct), down = finite(observed?.maxDownPct);
  const signalUp = finite(signal.maxUpPct), signalDown = finite(signal.maxDownPct);
  const date = new Date(t);
  const nextAnchor = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
  const wave = finite(signal.pct), btcWave = finite(observed?.pct);
  const price = finite(own?.vwap?.price);
  return [...directional.read(t, features, signal),
    finite(signal.vb > 0 && signal.vq > 0 && signal.p > 0 ? side * (signal.vq / (signal.vb * signal.p) - 1) * 100 : undefined),
    finite(observed && observed.vb > 0 && observed.vq > 0 && observed.p > 0 ? side * (observed.vq / (observed.vb * observed.p) - 1) * 100 : undefined),
    finite(observed && observed.vq > 0 && signal.vq > 0 ? Math.log(signal.vq / observed.vq) : undefined), up, down,
    up !== undefined && down !== undefined ? -side * (up - down) : undefined,
    signalUp !== undefined && signalDown !== undefined ? -side * (signalUp - signalDown) : undefined,
    finite(coin.mark !== undefined && signal.p > 0 ? -side * (coin.mark / signal.p - 1) * 100 : undefined),
    finite(anchor.mark !== undefined && observed && observed.p > 0 ? -side * (anchor.mark / observed.p - 1) * 100 : undefined),
    coin.anchorHours, anchor.anchorHours, Number.isFinite(t) ? Math.log1p((nextAnchor - t) / 3_600_000) : undefined,
    coin.sigmaPct !== undefined && wave !== undefined && wave > 0 ? coin.sigmaPct / wave : undefined,
    anchor.sigmaPct !== undefined && btcWave !== undefined && btcWave > 0 ? anchor.sigmaPct / btcWave : undefined,
    price !== undefined && price > 0 && wave !== undefined && wave > 0 ? side * (signal.p / price - 1) * 100 / wave : undefined,
    observed ? Math.log1p(Math.abs(signal.t - observed.t) / 3_600_000) : undefined,
    observed ? side * observed.lvl : undefined,
    wave !== undefined && wave > 0 && btcWave !== undefined && btcWave > 0 ? Math.log(wave / btcWave) : undefined,
  ];
}

const contextual = { names, read } as const;
export default contextual;
