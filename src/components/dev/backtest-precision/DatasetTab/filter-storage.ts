import datasetFilters from "@/lib/dev/feature-gate/filters";
import type { FeatureGateRowMetric } from "@/lib/dev/feature-gate";
import numericFilter from "@/lib/system/utils/numeric-filter";
import type { NumericFilterOperator } from "@/lib/system/utils/numeric-filter";

export interface DatasetFilterValues {
  symbol: string;
  from: string;
  to: string;
  metric: FeatureGateRowMetric;
  operator: NumericFilterOperator;
  value: string;
}

const key = "precision-backtest-dataset-filters";
const defaults: DatasetFilterValues = {
  symbol: "", from: "", to: "", metric: "missScore", operator: "eq", value: "",
};

/** Restores a date input only when it is a valid YYYY-MM-DD calendar date. */
function dateValue(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : "";
}

/** Restores filter selections, falling back safely for malformed or unavailable storage. */
function read(): DatasetFilterValues {
  if (typeof window === "undefined") return { ...defaults };
  try {
    const raw = window.localStorage.getItem(key);
    const stored: unknown = raw ? JSON.parse(raw) : undefined;
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return { ...defaults };
    const values = stored as Record<string, unknown>;
    return {
      symbol: typeof values.symbol === "string" ? values.symbol : defaults.symbol,
      from: dateValue(values.from),
      to: dateValue(values.to),
      metric: typeof values.metric === "string" && Object.hasOwn(datasetFilters.metrics, values.metric) ? values.metric as FeatureGateRowMetric : defaults.metric,
      operator: typeof values.operator === "string" && Object.hasOwn(numericFilter.operators, values.operator) ? values.operator as NumericFilterOperator : defaults.operator,
      value: typeof values.value === "string" && (values.value === "" || (values.value.trim() !== "" && Number.isFinite(Number(values.value)))) ? values.value : defaults.value,
    };
  } catch {
    return { ...defaults };
  }
}

/** Saves all selections; clearing to the defaults removes the stored filters. */
function write(filters: DatasetFilterValues): void {
  if (typeof window === "undefined") return;
  try {
    if (Object.entries(defaults).every(([field, value]) => filters[field as keyof DatasetFilterValues] === value)) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, JSON.stringify(filters));
    }
  } catch {
    // Keep filtering usable when localStorage is unavailable.
  }
}

const filterStorage = { defaults, key, read, write } as const;

export default filterStorage;
