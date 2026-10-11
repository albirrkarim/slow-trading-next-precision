/**
 * `management.indicators` config — defaults, normalization, and helpers
 * shared by the dashboard, the backtest form, and the runtime. Generic over
 * the registry: each type's `fields` drive validation.
 */

import {
  GATE_VWAP_ID,
  INDICATOR_ID_PATTERN,
  INDICATOR_INTERVALS,
  MAX_INDICATORS,
} from "./constants";
import indicatorRegistry from "./registry";
import type {
  FeatureIndicatorConfig,
  FeatureIndicatorDefs,
  FeatureIndicatorInterval,
  FeatureIndicatorType,
  IndicatorField,
} from "./types";

/**
 * Default stack when the config has none — the monthly 5m VWAP the gates
 * have always used, so an unconfigured install behaves as before.
 */
const DEFAULT_INDICATORS: FeatureIndicatorConfig[] = [
  { id: GATE_VWAP_ID, type: "vwap", interval: "5m", anchor: "month" },
];

/** Fresh instance of `type` with its defaults and the first unused id. */
function create(
  type: FeatureIndicatorType,
  existing: FeatureIndicatorConfig[],
): FeatureIndicatorConfig {
  const definition = indicatorRegistry.definitions[type];
  const used = new Set(existing.map((item) => item.id));
  let index = 1;
  while (used.has(`${definition.idPrefix}${index}`)) index += 1;
  return {
    id: `${definition.idPrefix}${index}`,
    type,
    ...definition.defaults,
  } as FeatureIndicatorConfig;
}

/** Field value coerced to its declared kind, or undefined when invalid. */
function fieldValue(field: IndicatorField, raw: unknown): unknown {
  if (field.kind === "select") {
    return typeof raw === "string" && field.options.includes(raw) ? raw : undefined;
  }
  const value = field.kind === "integer" ? Math.round(Number(raw)) : Number(raw);
  return Number.isFinite(value) && value >= field.min && value <= field.max
    ? value
    : undefined;
}

/**
 * Coerces one raw entry into a typed instance, or undefined when it cannot
 * be computed (unknown type, bad id/interval, out-of-range params).
 */
function normalizeOne(raw: unknown): FeatureIndicatorConfig | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const item = raw as Record<string, unknown>;
  const definition = indicatorRegistry.types.includes(item.type as FeatureIndicatorType)
    ? indicatorRegistry.of(item as Pick<FeatureIndicatorConfig, "type">)
    : undefined;
  const id = typeof item.id === "string" ? item.id.trim() : "";
  const interval = item.interval as FeatureIndicatorInterval;
  if (!definition || !INDICATOR_ID_PATTERN.test(id) || !INDICATOR_INTERVALS.includes(interval)) {
    return undefined;
  }
  const params: Record<string, unknown> = {};
  for (const field of definition.fields as readonly IndicatorField[]) {
    const value = fieldValue(field, item[field.key]);
    if (value === undefined) return undefined;
    params[field.key] = value;
  }
  return {
    id,
    type: definition.type,
    interval,
    ...params,
    ...(item.on === false ? { on: false } : {}),
  } as FeatureIndicatorConfig;
}

/**
 * Normalized instance list: absent config → the default monthly VWAP;
 * invalid entries and duplicate ids are dropped (first wins); capped at
 * `MAX_INDICATORS`. An explicit empty array stays empty.
 */
function normalize(raw: unknown): FeatureIndicatorConfig[] {
  if (!Array.isArray(raw)) return structuredClone(DEFAULT_INDICATORS);
  const seen = new Set<string>();
  const out: FeatureIndicatorConfig[] = [];
  for (const entry of raw) {
    const item = normalizeOne(entry);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
    if (out.length >= MAX_INDICATORS) break;
  }
  return out;
}

/** Enabled instances of a normalized list. */
function enabled(list: FeatureIndicatorConfig[]): FeatureIndicatorConfig[] {
  return list.filter((item) => item.on !== false);
}

const resolved = new WeakMap<object, FeatureIndicatorConfig[]>();

/**
 * Enabled, normalized instances for a raw config value — memoized per
 * array identity so the per-tick feed/update never re-validates an
 * unchanged config.
 */
function resolve(raw: unknown): FeatureIndicatorConfig[] {
  if (!Array.isArray(raw)) return DEFAULT_INDICATORS;
  let list = resolved.get(raw);
  if (!list) {
    list = enabled(normalize(raw));
    resolved.set(raw, list);
  }
  return list;
}

/** Enabled instances keyed by id — the `defs` snapshot shape. */
function defs(list: FeatureIndicatorConfig[]): FeatureIndicatorDefs {
  const out: FeatureIndicatorDefs = {};
  for (const item of enabled(list)) out[item.id] = item;
  return out;
}

/** Params key of an instance (see `IndicatorDefinition.key`). */
function key(item: FeatureIndicatorConfig): string {
  return indicatorRegistry.of(item).key(item);
}

/** Human summary, e.g. "Supertrend 15m · 10 × 3" or "VWAP 5m · month". */
function summary(item: FeatureIndicatorConfig): string {
  return indicatorRegistry.of(item).summary(item);
}

/** True when the gates' monthly VWAP instance is present and enabled. */
function hasGateVwap(list: FeatureIndicatorConfig[]): boolean {
  return list.some(
    (item) =>
      item.id === GATE_VWAP_ID &&
      item.type === "vwap" &&
      item.anchor === "month" &&
      item.on !== false,
  );
}

const indicatorConfig = {
  create,
  defs,
  enabled,
  hasGateVwap,
  key,
  normalize,
  resolve,
  summary,
} as const;

export default indicatorConfig;
