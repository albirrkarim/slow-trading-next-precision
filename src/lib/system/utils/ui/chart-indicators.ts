/**
 * TradingView-style indicator stack for the trade chart: the V-Points
 * marker layer plus any number of independently configured anchored-VWAP
 * instances. UI preference only — persisted to localStorage with compact
 * keys, never to runtime storage.
 */

import type { VwapAnchor } from "./vwap";

export interface VwapIndicatorConfig {
  /** Stable instance id (React key + legend identity). */
  id: string;
  /** Hidden instances keep their settings but draw nothing. */
  visible: boolean;
  anchor: VwapAnchor;
  /** Std-dev multipliers for the band envelope, e.g. [1, 2]. */
  bands: number[];
  /** Line color (hex); bands and fill derive from it. */
  color: string;
  /** Shade between each band pair. */
  fill: boolean;
  /**
   * Month anchor only: fold the runtime gate's own 5m candles from the
   * month start instead of the chart's candles, so line and σ bands match
   * what the feature gate measured.
   */
  gate: boolean;
}

export interface ChartIndicatorsConfig {
  /** Draw the volatility-point (V-Points) markers. */
  vPoints: boolean;
  vwaps: VwapIndicatorConfig[];
}

const STORAGE_KEY = "precision:trade-chart-indicators:v1";
/** Pre-multi-instance single-VWAP preference — migrated once on load. */
const LEGACY_VWAP_KEY = "precision:trade-chart-vwap:v1";

export const VWAP_ANCHORS: { value: VwapAnchor; label: string; short: string }[] =
  [
    { value: "session", label: "Session", short: "D" },
    { value: "week", label: "Week", short: "W" },
    { value: "month", label: "Month", short: "M" },
    { value: "all", label: "All data", short: "All" },
    { value: "entry", label: "Entry", short: "Entry" },
    { value: "vpoint", label: "V-Points", short: "VP" },
  ];

/** Line colors offered in settings; new instances take the first unused. */
export const VWAP_COLORS = [
  "#2962ff",
  "#ff6d00",
  "#00897b",
  "#aa00ff",
  "#c51162",
  "#795548",
  "#fbc02d",
  "#546e7a",
];

const DEFAULT_CONFIG: ChartIndicatorsConfig = { vPoints: true, vwaps: [] };

const ANCHOR_VALUES = VWAP_ANCHORS.map((option) => option.value);

/** Short random id — collisions only matter within one chart's stack. */
function newId(): string {
  return Math.random().toString(36).slice(2, 8);
}

/** Keeps finite positive multipliers, deduped and sorted ascending. */
function normalizeBands(bands: unknown): number[] | undefined {
  if (!Array.isArray(bands)) return undefined;
  const clean = bands.filter(
    (x): x is number => typeof x === "number" && Number.isFinite(x) && x > 0,
  );
  return [...new Set(clean)].sort((a, b) => a - b);
}

/** Parses user band input like "1, 1.5 2" into sorted multipliers. */
function parseBands(input: string): number[] {
  return (
    normalizeBands(
      input
        .split(/[\s,;]+/)
        .filter(Boolean)
        .map((token) => Number(token)),
    ) ?? []
  );
}

/** Creates a VWAP instance with the first color not already in use. */
function createVwap(
  existing: VwapIndicatorConfig[],
  patch: Partial<VwapIndicatorConfig> = {},
): VwapIndicatorConfig {
  const used = new Set(existing.map((item) => item.color));
  return {
    id: newId(),
    visible: true,
    anchor: "month",
    bands: [1, 2],
    color:
      VWAP_COLORS.find((color) => !used.has(color)) ??
      VWAP_COLORS[existing.length % VWAP_COLORS.length],
    fill: true,
    gate: false,
    ...patch,
  };
}

/** True when the instance folds the gate's 5m candles (Month anchor only). */
function matchesGate(config: Pick<VwapIndicatorConfig, "anchor" | "gate">) {
  return config.gate && config.anchor === "month";
}

/** Compact legend/axis label, e.g. "VWAP M ±1,2σ" or "VWAP M·gate ±1σ". */
function vwapLabel(
  config: Pick<VwapIndicatorConfig, "anchor" | "bands"> &
    Partial<Pick<VwapIndicatorConfig, "gate">>,
) {
  const short =
    VWAP_ANCHORS.find((option) => option.value === config.anchor)?.short ??
    config.anchor;
  const name = `VWAP ${short}${matchesGate({ anchor: config.anchor, gate: config.gate === true }) ? "·gate" : ""}`;
  return config.bands.length
    ? `${name} ±${config.bands.join(",")}σ`
    : name;
}

/** Decodes one compact stored VWAP entry; undefined when malformed. */
function decodeVwap(raw: any): VwapIndicatorConfig | undefined {
  if (!raw || typeof raw !== "object" || !ANCHOR_VALUES.includes(raw.a)) {
    return undefined;
  }
  return {
    id: typeof raw.i === "string" && raw.i ? raw.i : newId(),
    visible: raw.h !== 1,
    anchor: raw.a,
    bands: normalizeBands(raw.b) ?? [1, 2],
    color:
      typeof raw.c === "string" && /^#[0-9a-f]{6}$/i.test(raw.c)
        ? raw.c
        : VWAP_COLORS[0],
    fill: raw.f !== 0,
    gate: raw.g === 1,
  };
}

/** Converts the legacy single-VWAP preference into the indicator stack. */
function migrateLegacy(): ChartIndicatorsConfig | undefined {
  const raw = window.localStorage.getItem(LEGACY_VWAP_KEY);
  if (!raw) return undefined;
  const parsed = JSON.parse(raw);
  const vwap = decodeVwap({ a: parsed?.a, b: parsed?.b, c: VWAP_COLORS[0] });
  return {
    vPoints: true,
    vwaps: parsed?.e === true && vwap ? [vwap] : [],
  };
}

/**
 * Reads the persisted indicator stack; falls back to the legacy VWAP
 * preference, then defaults, so a bad blob never breaks the chart.
 */
function load(): ChartIndicatorsConfig {
  try {
    if (typeof window === "undefined") return DEFAULT_CONFIG;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return migrateLegacy() ?? DEFAULT_CONFIG;
    const parsed = JSON.parse(raw);
    return {
      vPoints: parsed?.v !== 0,
      vwaps: Array.isArray(parsed?.w)
        ? parsed.w
            .map(decodeVwap)
            .filter((item: VwapIndicatorConfig | undefined) => item)
        : [],
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

/** Persists the indicator stack (compact keys — UI preference only). */
function save(config: ChartIndicatorsConfig) {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        v: config.vPoints ? 1 : 0,
        w: config.vwaps.map((item) => ({
          i: item.id,
          ...(item.visible ? {} : { h: 1 }),
          a: item.anchor,
          b: item.bands,
          c: item.color,
          ...(item.fill ? {} : { f: 0 }),
          ...(item.gate ? { g: 1 } : {}),
        })),
      }),
    );
  } catch {
    // localStorage unavailable — config simply won't persist.
  }
}

const chartIndicators = {
  DEFAULT: DEFAULT_CONFIG,
  load,
  save,
  vwap: {
    create: createVwap,
    label: vwapLabel,
    matchesGate,
    parseBands,
  },
};

export default chartIndicators;
