import numericFilter from "@/lib/system/utils/numeric-filter";

import type { FeatureGateDatasetRow, FeatureGateRowMetric, FeatureGateRowQuery } from "./types";

/** Reads finite numeric values without treating absent inputs as zero. */
function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Numeric row and captured-feature values available to the condition picker. */
const metrics = {
  missScore: { label: "Miss score", read: (row: FeatureGateDatasetRow) => row.missScore },
  signalLevel: { label: "Starting |level|", read: (row: FeatureGateDatasetRow) => {
    const level = finite(row.sequences[0]?.lvl);
    return level === undefined ? undefined : Math.abs(level);
  } },
  reversalLevel: { label: "Reversal |level|", read: (row: FeatureGateDatasetRow) => {
    const level = row.resolved ? finite(row.sequences.at(-1)?.lvl) : undefined;
    return level === undefined ? undefined : Math.abs(level);
  } },
  sequenceLength: { label: "Sequence length", read: (row: FeatureGateDatasetRow) => row.sequences.length },
  signalPct: { label: "Signal pct", read: (row: FeatureGateDatasetRow) => row.sequences[0]?.pct },
  signalMaxUpPct: { label: "Signal max up pct", read: (row: FeatureGateDatasetRow) => row.sequences[0]?.maxUpPct },
  signalAgeMinutes: { label: "Signal age (minutes)", read: (row: FeatureGateDatasetRow) => {
    const t = finite(row.t);
    const signalT = finite(row.sequences[0]?.t);
    return t === undefined || signalT === undefined ? undefined : (t - signalT) / 60_000;
  } },
  priceNormalized: { label: "Coin price normalized", read: (row: FeatureGateDatasetRow) => row.feature?.coins[row.symbol]?.priceNormalized?.current },
  btcPriceNormalized: { label: "BTC price normalized", read: (row: FeatureGateDatasetRow) => row.feature?.coins.BTC?.priceNormalized?.current },
  vwapDistancePct: { label: "Coin VWAP distance pct", read: (row: FeatureGateDatasetRow) => row.feature?.coins[row.symbol]?.vwap?.distancePct },
  vwapStretchPct: { label: "Coin VWAP stretch pct", read: (row: FeatureGateDatasetRow) => row.feature?.coins[row.symbol]?.vwap?.stretchPct },
};

/** Applies all dataset constraints with AND semantics before pagination. */
function matches(row: FeatureGateDatasetRow, query: FeatureGateRowQuery): boolean {
  if (query.symbol && row.symbol !== query.symbol) return false;
  if (query.signalId !== undefined && row.sequences[0]?.id !== query.signalId) return false;
  if (query.minMissScore !== undefined && (row.missScore ?? -1) < query.minMissScore) return false;
  if (query.fromT !== undefined || query.toT !== undefined) {
    const t = finite(row.t);
    if (t === undefined || (query.fromT !== undefined && t < query.fromT) || (query.toT !== undefined && t > query.toT)) return false;
  }
  if (query.metric && query.operator && query.value !== undefined) {
    const value = finite(metrics[query.metric].read(row));
    return value !== undefined && numericFilter.operators[query.operator].test(value, query.value);
  }
  return true;
}

/** Validates one HTTP numeric condition; an omitted condition leaves rows unfiltered. */
function parseCondition(metric?: string, operator?: string, rawValue?: string): Pick<FeatureGateRowQuery, "metric" | "operator" | "value"> {
  if (metric === undefined && operator === undefined && rawValue === undefined) return {};
  const value = rawValue?.trim() ? Number(rawValue) : Number.NaN;
  if (!metric || !Object.hasOwn(metrics, metric) || !operator || !Object.hasOwn(numericFilter.operators, operator) || !Number.isFinite(value)) {
    throw new Error('Supply a valid "metric", "operator", and finite numeric "value" together.');
  }
  return { metric: metric as FeatureGateRowMetric, operator: operator as NonNullable<FeatureGateRowQuery["operator"]>, value };
}

const datasetFilters = { matches, metrics, parseCondition } as const;

export default datasetFilters;
