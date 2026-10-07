import type { CoinFeatures, RuntimeFeatures } from "@/lib/features/types";
import type { VolatilityPoint } from "@/lib/system/types";

const fields = ["extreme", "span", "lastChange", "change6h", "change24h", "change72h", "change168h", "meanDistance", "rangePosition", "vwapSigma", "sigmaPct"];
const names = [
  "side", "absoluteLevel", "continuationLevel", "signalPct", "logAgeHours", "maxUpPct", "maxDownPct", "signalSigma",
  ...fields.map((name) => `coin.${name}`), ...fields.map((name) => `btc.${name}`),
  "btc.sideAlignment", "btc.absoluteLevel", "btc.signalPct", "btc.logAgeHours",
  "relative.extreme", "relative.vwapSigma", "relative.change24h", "relative.change72h", "relative.sigmaRatio",
];

/** Preserves absence and rejects nonfinite observations. */
function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Computes a difference only when both capture-time observations exist. */
function difference(a: number | undefined, b: number | undefined): number | undefined {
  return a === undefined || b === undefined ? undefined : a - b;
}

/** Reads direction-aligned extrema and elapsed-time trends from an observed step-function trail. */
function coinValues(coin: CoinFeatures | undefined, t: number, side: number): Array<number | undefined> {
  const current = finite(coin?.priceNormalized?.current);
  const history = (coin?.priceNormalized?.history ?? []).filter((point) => Number.isFinite(point.t) && Number.isFinite(point.p) && point.t <= t).sort((a, b) => a.t - b.t);
  const values = history.map((point) => point.p);
  const min = values.length ? Math.min(...values) : undefined;
  const max = values.length ? Math.max(...values) : undefined;
  const change = (hours: number): number | undefined => {
    const prior = history.findLast((point) => point.t <= t - hours * 3_600_000);
    return current === undefined || !prior ? undefined : side * (current - prior.p);
  };
  const price = finite(coin?.vwap?.price);
  const sigma = finite(coin?.vwap?.stdev);
  const distance = finite(coin?.vwap?.distancePct);
  const sigmaPct = price !== undefined && price > 0 && sigma !== undefined && sigma > 0 ? sigma / price * 100 : undefined;
  return [
    current === undefined ? undefined : side * (current - 0.5),
    difference(max, min), current === undefined || values.length < 2 ? undefined : side * (current - values.at(-2)!),
    change(6), change(24), change(72), change(168),
    current === undefined || !values.length ? undefined : side * (current - values.reduce((a, b) => a + b, 0) / values.length),
    current === undefined || min === undefined || max === undefined || max <= min ? undefined : side * ((current - min) / (max - min) - 0.5),
    distance === undefined || sigmaPct === undefined ? undefined : side * distance / sigmaPct, sigmaPct,
  ];
}

/** BOTH:FEATURE_NN — engineering uses only the frozen capture and BTC context, never future outcomes or coin identity. */
function read(t: number, features: RuntimeFeatures | undefined, signal: VolatilityPoint): Array<number | undefined> {
  const symbol = (signal.symbol ?? "").toUpperCase().replace(/_USDT$/, "");
  const own = features?.coins[symbol];
  const btc = features?.coins.BTC;
  const side = signal.l === "B" ? -1 : 1;
  const coin = coinValues(own, t, side);
  const anchor = coinValues(btc, t, side);
  const point = btc?.latestVpoint;
  const observedPoint = point && Number.isFinite(point.t) && point.t <= t ? point : undefined;
  const price = finite(own?.vwap?.price);
  const sigma = finite(own?.vwap?.stdev);
  return [
    side, Math.abs(signal.lvl), side * signal.lvl, finite(signal.pct), Math.log1p(Math.max(0, t - signal.t) / 3_600_000),
    finite(signal.maxUpPct), finite(signal.maxDownPct),
    price === undefined || sigma === undefined || sigma <= 0 ? undefined : side * (signal.p - price) / sigma,
    ...coin, ...anchor,
    observedPoint ? side * (observedPoint.l === "B" ? -1 : 1) : undefined,
    observedPoint ? Math.abs(observedPoint.lvl) : undefined, finite(observedPoint?.pct),
    observedPoint ? Math.log1p((t - observedPoint.t) / 3_600_000) : undefined,
    difference(coin[0], anchor[0]), difference(coin[9], anchor[9]), difference(coin[4], anchor[4]), difference(coin[5], anchor[5]),
    coin[10] === undefined || anchor[10] === undefined ? undefined : Math.log(coin[10]! / anchor[10]!),
  ];
}

const directional = { names, read } as const;
export default directional;
