import indicators, {
  type FeatureIndicatorDefs,
  type FeatureIndicatorType,
} from "@/lib/features/indicators";
import numericFilter from "@/lib/system/utils/numeric-filter";

import type { FeatureGateDatasetRow, FeatureGateRowMetric, FeatureGateRowQuery, FeatureGateStaticMetric } from "./types";

/** Reads finite numeric values without treating absent inputs as zero. */
function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** The gates' monthly VWAP reading of the row's own coin (current or legacy shape). */
function coinVwap(row: FeatureGateDatasetRow) {
  return indicators.read.vwap(row.feature?.coins[row.symbol]);
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
  vwapDistancePct: { label: "Coin VWAP distance pct", read: (row: FeatureGateDatasetRow) => coinVwap(row)?.distancePct },
  vwapStretchPct: { label: "Coin VWAP stretch pct", read: (row: FeatureGateDatasetRow) => coinVwap(row)?.stretchPct },
  vwapDSigma: { label: "Coin VWAP distance (σ)", read: (row: FeatureGateDatasetRow) => coinVwap(row)?.dSigma },
  vwapMonthDay: { label: "VWAP month-to-date (days)", read: (row: FeatureGateDatasetRow) => {
    const t = finite(row.t);
    const anchorT = finite(coinVwap(row)?.anchorT);
    return t === undefined || anchorT === undefined ? undefined : (t - anchorT) / 86_400_000;
  } },
};

type MetricEntry = { label: string; read: (row: FeatureGateDatasetRow) => number | undefined };

const INDICATOR_METRIC = /^ind:([a-z]+):([a-z][a-z0-9_]{0,15}):([A-Za-z]+)$/;

/** Resolves a static metric key or a dynamic `ind:<type>:<id>:<field>` key. */
function resolve(metric: string): MetricEntry | undefined {
  if (Object.hasOwn(metrics, metric)) return metrics[metric as FeatureGateStaticMetric];
  const match = INDICATOR_METRIC.exec(metric);
  if (!match) return undefined;
  const [, type, id, field] = match as unknown as [string, FeatureIndicatorType, string, string];
  if (!indicators.registry.types.includes(type)) return undefined;
  const indicatorMetric = indicators.registry.definitions[type].metrics[field];
  if (!indicatorMetric) return undefined;
  return {
    label: `${id} · ${indicatorMetric.label}`,
    read: (row) => finite(indicatorMetric.read(
      row.feature?.coins[row.symbol]?.ind?.[type]?.[id],
      finite(row.t),
    )),
  };
}

/** Static metrics plus every field of each indicator in `defs` (from captured rows). */
function metricsFor(defs: FeatureIndicatorDefs | undefined): Record<FeatureGateRowMetric, { label: string }> {
  const out: Record<string, { label: string }> = { ...metrics };
  for (const def of Object.values(defs ?? {})) {
    const definition = indicators.registry.of(def);
    for (const [field, metric] of Object.entries(definition.metrics)) {
      out[`ind:${def.type}:${def.id}:${field}`] = {
        label: `${indicators.config.summary(def)} (${def.id}) · ${(metric as { label: string }).label}`,
      };
    }
  }
  return out as Record<FeatureGateRowMetric, { label: string }>;
}

/** Union of the indicator definitions captured across rows (first wins per id). */
function rowDefs(rows: FeatureGateDatasetRow[]): FeatureIndicatorDefs {
  const out: FeatureIndicatorDefs = {};
  for (const row of rows) {
    for (const [id, def] of Object.entries(row.feature?.defs ?? {})) out[id] ??= def;
  }
  return out;
}

/** Applies all dataset constraints with AND semantics before pagination. */
function matches(row: FeatureGateDatasetRow, query: FeatureGateRowQuery): boolean {
  if (query.symbol && row.symbol !== query.symbol) return false;
  if (query.minMissScore !== undefined && (row.missScore ?? -1) < query.minMissScore) return false;
  if (query.fromT !== undefined || query.toT !== undefined) {
    const t = finite(row.t);
    if (t === undefined || (query.fromT !== undefined && t < query.fromT) || (query.toT !== undefined && t > query.toT)) return false;
  }
  if (query.metric && query.operator && query.value !== undefined) {
    const entry = resolve(query.metric);
    const value = entry ? finite(entry.read(row)) : undefined;
    return value !== undefined && numericFilter.operators[query.operator].test(value, query.value);
  }
  return true;
}

/** Validates one HTTP numeric condition; an omitted condition leaves rows unfiltered. */
function parseCondition(metric?: string, operator?: string, rawValue?: string): Pick<FeatureGateRowQuery, "metric" | "operator" | "value"> {
  if (metric === undefined && operator === undefined && rawValue === undefined) return {};
  const value = rawValue?.trim() ? Number(rawValue) : Number.NaN;
  if (!metric || !resolve(metric) || !operator || !Object.hasOwn(numericFilter.operators, operator) || !Number.isFinite(value)) {
    throw new Error('Supply a valid "metric", "operator", and finite numeric "value" together.');
  }
  return { metric: metric as FeatureGateRowMetric, operator: operator as NonNullable<FeatureGateRowQuery["operator"]>, value };
}

const datasetFilters = { matches, metrics, metricsFor, parseCondition, resolve, rowDefs } as const;

export default datasetFilters;
