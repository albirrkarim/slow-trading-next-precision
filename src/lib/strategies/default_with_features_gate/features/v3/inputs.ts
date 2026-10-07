import type { CoinFeatures, RuntimeFeatures } from "@/lib/features/types";
import type { VolatilityPoint } from "@/lib/system/types";

import directional from "./directional";
import type { InputNormalization, NeuralInputProfile } from "./types";

const COIN_FIELDS = ["norm", "last2", "last3", "last5", "min", "max", "span", "mean", "change", "trailAgeHours", "distancePct", "stretchPct", "sigmaPct"];
const names = [
  "side", "level", "absoluteLevel", "signalPct", "ageHours", "maxUpPct", "maxDownPct", "signalSigmaDistance",
  ...COIN_FIELDS.map((name) => `coin.${name}`),
  ...COIN_FIELDS.map((name) => `btc.${name}`),
];

/** Returns finite observations only; absence is never silently interpreted as zero. */
function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Computes scale-independent coin inputs from the frozen, already-observed feature trail. */
function coinValues(coin: CoinFeatures | undefined, currentTime: number): Array<number | undefined> {
  const current = finite(coin?.priceNormalized?.current);
  const history = (coin?.priceNormalized?.history ?? []).filter((point) =>
    finite(point.t) !== undefined && finite(point.p) !== undefined && point.t <= currentTime,
  );
  const values = history.map((point) => point.p);
  const min = values.length ? Math.min(...values) : undefined;
  const max = values.length ? Math.max(...values) : undefined;
  const vwap = coin?.vwap;
  const price = finite(vwap?.price);
  const sigma = finite(vwap?.stdev);
  return [
    current, values.at(-2), values.at(-3), values.at(-5), min, max,
    min === undefined || max === undefined ? undefined : max - min,
    values.length ? values.reduce((a, b) => a + b, 0) / values.length : undefined,
    current === undefined || !values.length ? undefined : current - values[0],
    history.length ? (currentTime - history[0].t) / 3_600_000 : undefined,
    finite(vwap?.distancePct), finite(vwap?.stretchPct),
    price !== undefined && price > 0 && sigma !== undefined && sigma >= 0 ? sigma / price * 100 : undefined,
  ];
}

/** BTEST:FEATURE_NN — capture-time inputs only; future sequences, outcomes, ids and absolute prices are excluded. */
function valid(currentTime: number, features: RuntimeFeatures | undefined, signal: VolatilityPoint): boolean {
  const symbol = (signal.symbol ?? "").toUpperCase().replace(/_USDT$/, "");
  return Number.isFinite(currentTime) && !!features?.coins[symbol] && !!features.coins.BTC &&
    Number.isFinite(signal.t) && signal.t <= currentTime && Number.isFinite(signal.lvl) &&
    Number.isFinite(signal.p) && signal.p > 0 && (signal.l === "B" || signal.l === "T");
}

/** Reads numerical inputs without access to any future outcome label. */
function read(currentTime: number, features: RuntimeFeatures | undefined, signal: VolatilityPoint, profile: NeuralInputProfile = "legacy"): Array<number | undefined> {
  if (profile === "directional") return directional.read(currentTime, features, signal);
  const symbol = (signal.symbol ?? "").toUpperCase().replace(/_USDT$/, "");
  const coin = features?.coins[symbol];
  const price = finite(coin?.vwap?.price);
  const sigma = finite(coin?.vwap?.stdev);
  const signalPrice = finite(signal.p);
  const signalT = finite(signal.t);
  const level = finite(signal.lvl);
  return [
    signal.l === "B" ? -1 : signal.l === "T" ? 1 : undefined,
    level, level === undefined ? undefined : Math.abs(level), finite(signal.pct),
    signalT === undefined ? undefined : (currentTime - signalT) / 3_600_000,
    finite(signal.maxUpPct), finite(signal.maxDownPct),
    price !== undefined && sigma !== undefined && sigma > 0 && signalPrice !== undefined ? Math.abs(signalPrice - price) / sigma : undefined,
    ...coinValues(coin, currentTime), ...coinValues(features?.coins.BTC, currentTime),
  ];
}

/** Fits mean/std using observed training values only. */
function fit(rows: Array<Array<number | undefined>>, profile: NeuralInputProfile = "legacy"): InputNormalization {
  if (!rows.length) throw new Error("Cannot fit normalization on an empty training set.");
  const fields = namesFor(profile);
  if (rows.some((row) => row.length !== fields.length)) throw new Error("NN input feature count mismatch.");
  const mean = fields.map((_, index) => {
    const values = rows.map((row) => row[index]).filter((value): value is number => finite(value) !== undefined);
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  });
  const std = fields.map((_, index) => {
    const values = rows.map((row) => row[index]).filter((value): value is number => finite(value) !== undefined);
    const variance = values.length ? values.reduce((sum, value) => sum + (value - mean[index]) ** 2, 0) / values.length : 0;
    return Math.sqrt(variance) > 1e-8 ? Math.sqrt(variance) : 1;
  });
  return { mean, std, clip: 8 };
}

/** Applies frozen training normalization and appends one presence channel per feature. */
function encode(raw: Array<number | undefined>, normalization: InputNormalization): number[] {
  if (raw.length !== normalization.mean.length || raw.length !== normalization.std.length) throw new Error("NN input feature count mismatch.");
  return [
    ...raw.map((value, index) => finite(value) === undefined ? 0 : Math.max(-normalization.clip, Math.min(normalization.clip, (value! - normalization.mean[index]) / normalization.std[index]))),
    ...raw.map((value) => finite(value) === undefined ? 0 : 1),
  ];
}

/** Returns the exact persisted feature order for a supported preprocessing profile. */
function namesFor(profile: NeuralInputProfile = "legacy"): string[] {
  return profile === "directional" ? directional.names : names;
}

const inputs = { encode, fit, names, namesFor, read, valid } as const;
export default inputs;
