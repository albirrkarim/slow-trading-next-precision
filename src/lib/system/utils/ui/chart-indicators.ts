/**
 * TradingView-style indicator stack for the trade chart: the V-Points
 * marker layer plus any number of independently configured anchored-VWAP,
 * Supertrend, and EMA instances. UI preference only — persisted to localStorage
 * with compact keys, never to runtime storage.
 */

import indicators, {
  INDICATOR_INTERVALS,
  type EmaSource,
  type FeatureIndicatorDefs,
  type FeatureIndicatorInterval,
} from "@/lib/features/indicators";

import type { VwapAnchor } from "./chart-vwap";

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
   * Session/week/month anchors only: fold runtime-style closed candles of
   * `src` (default 5m) from the anchor start instead of the chart's
   * candles, so line and σ bands match what the feature pipeline measured.
   */
  gate: boolean;
  /** Candle interval folded in gate mode; absent = the runtime's 5m. */
  src?: FeatureIndicatorInterval;
}

/** Supertrend overlay — green line in an uptrend, red in a downtrend. */
export interface SupertrendChartConfig {
  id: string;
  visible: boolean;
  atrLength: number;
  factor: number;
  /**
   * Candle interval to fold (with warm-up history), resampled onto the
   * chart; absent = the chart's own candles.
   */
  src?: FeatureIndicatorInterval;
}

/** EMA overlay — one colored line. */
export interface EmaChartConfig {
  id: string;
  visible: boolean;
  length: number;
  source: EmaSource;
  /** Line color (hex). */
  color: string;
  /**
   * Candle interval to fold (with warm-up history), resampled onto the
   * chart; absent = the chart's own candles.
   */
  src?: FeatureIndicatorInterval;
}

export interface ChartIndicatorsConfig {
  /** Draw the volatility-point (V-Points) markers. */
  vPoints: boolean;
  vwaps: VwapIndicatorConfig[];
  supertrends: SupertrendChartConfig[];
  emas: EmaChartConfig[];
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

const DEFAULT_CONFIG: ChartIndicatorsConfig = {
  vPoints: true,
  vwaps: [],
  supertrends: [],
  emas: [],
};

const EMA_SOURCES: EmaSource[] = ["close", "hl2", "hlc3"];

const GATE_ANCHORS: VwapAnchor[] = ["session", "week", "month"];

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

/**
 * Candle interval a gate-mode VWAP folds, or undefined when it folds the
 * chart's candles (gate off, or an anchor the runtime has no notion of).
 */
function vwapSource(
  config: Pick<VwapIndicatorConfig, "anchor" | "gate" | "src">,
): FeatureIndicatorInterval | undefined {
  return config.gate && GATE_ANCHORS.includes(config.anchor)
    ? (config.src ?? "5m")
    : undefined;
}

/** True when the instance folds runtime-style source candles. */
function matchesGate(config: Pick<VwapIndicatorConfig, "anchor" | "gate" | "src">) {
  return vwapSource(config) !== undefined;
}

/** Compact legend/axis label, e.g. "VWAP M ±1,2σ" or "VWAP M·5m ±1σ". */
function vwapLabel(
  config: Pick<VwapIndicatorConfig, "anchor" | "bands"> &
    Partial<Pick<VwapIndicatorConfig, "gate" | "src">>,
) {
  const short =
    VWAP_ANCHORS.find((option) => option.value === config.anchor)?.short ??
    config.anchor;
  const source = vwapSource({
    anchor: config.anchor,
    gate: config.gate === true,
    src: config.src,
  });
  const name = `VWAP ${short}${source ? `·${source}` : ""}`;
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
    ...(INDICATOR_INTERVALS.includes(raw.s) ? { src: raw.s } : {}),
  };
}

/** Creates a Supertrend overlay (TradingView defaults 10 × 3). */
function createSupertrend(
  patch: Partial<SupertrendChartConfig> = {},
): SupertrendChartConfig {
  return { id: newId(), visible: true, atrLength: 10, factor: 3, ...patch };
}

/** Legend/axis label, e.g. "ST 10×3" or "ST 10×3·1h". */
function supertrendLabel(config: SupertrendChartConfig): string {
  return `ST ${config.atrLength}×${config.factor}${config.src ? `·${config.src}` : ""}`;
}

/** Decodes one compact stored Supertrend entry; undefined when malformed. */
function decodeSupertrend(raw: any): SupertrendChartConfig | undefined {
  const atrLength = Number(raw?.l);
  const factor = Number(raw?.f);
  if (
    !Number.isInteger(atrLength) || atrLength < 1 || atrLength > 500 ||
    !Number.isFinite(factor) || factor <= 0 || factor > 50
  ) {
    return undefined;
  }
  return {
    id: typeof raw.i === "string" && raw.i ? raw.i : newId(),
    visible: raw.h !== 1,
    atrLength,
    factor,
    ...(INDICATOR_INTERVALS.includes(raw.s) ? { src: raw.s } : {}),
  };
}

/** Creates an EMA overlay with the first line color not already used. */
function createEma(
  existing: ChartIndicatorsConfig,
  patch: Partial<EmaChartConfig> = {},
): EmaChartConfig {
  const used = new Set([
    ...existing.vwaps.map((item) => item.color),
    ...existing.emas.map((item) => item.color),
  ]);
  return {
    id: newId(),
    visible: true,
    length: 50,
    source: "close",
    color:
      VWAP_COLORS.find((color) => !used.has(color)) ??
      VWAP_COLORS[existing.emas.length % VWAP_COLORS.length],
    ...patch,
  };
}

/** Legend/axis label, e.g. "EMA 50" or "EMA 200 hl2·1h". */
function emaLabel(config: EmaChartConfig): string {
  const source = config.source === "close" ? "" : ` ${config.source}`;
  return `EMA ${config.length}${source}${config.src ? `·${config.src}` : ""}`;
}

/** Decodes one compact stored EMA entry; undefined when malformed. */
function decodeEma(raw: any): EmaChartConfig | undefined {
  const length = Number(raw?.l);
  if (!Number.isInteger(length) || length < 1 || length > 500) return undefined;
  return {
    id: typeof raw.i === "string" && raw.i ? raw.i : newId(),
    visible: raw.h !== 1,
    length,
    source: EMA_SOURCES.includes(raw.o) ? raw.o : "close",
    color:
      typeof raw.c === "string" && /^#[0-9a-f]{6}$/i.test(raw.c)
        ? raw.c
        : VWAP_COLORS[0],
    ...(INDICATOR_INTERVALS.includes(raw.s) ? { src: raw.s } : {}),
  };
}

/**
 * True when the chart already draws an instance equivalent to `def`
 * (same type, params, and runtime candle interval) — the stack is
 * remembered across charts, so re-adding would stack duplicates.
 */
function hasDef(config: ChartIndicatorsConfig, def: FeatureIndicatorDefs[string]): boolean {
  switch (def.type) {
    case "vwap":
      return config.vwaps.some(
        (item) => item.anchor === def.anchor && vwapSource(item) === def.interval,
      );
    case "supertrend":
      return config.supertrends.some(
        (item) =>
          item.atrLength === def.atrLength &&
          item.factor === def.factor &&
          item.src === def.interval,
      );
    case "ema":
      return config.emas.some(
        (item) =>
          item.length === def.length &&
          item.source === def.source &&
          item.src === def.interval,
      );
    default:
      return false;
  }
}

/**
 * Chart instances mirroring captured feature definitions not already on
 * the chart — each folds the same candle interval the runtime did, so the
 * overlay shows what the gates saw.
 */
function fromDefs(
  defs: FeatureIndicatorDefs,
  existing: ChartIndicatorsConfig,
): Pick<ChartIndicatorsConfig, "vwaps" | "supertrends" | "emas"> {
  const vwaps: VwapIndicatorConfig[] = [];
  const supertrends: SupertrendChartConfig[] = [];
  const emas: EmaChartConfig[] = [];
  for (const def of Object.values(defs)) {
    if (hasDef(existing, def)) continue;
    switch (def.type) {
      case "vwap":
        vwaps.push(createVwap([...existing.vwaps, ...vwaps], {
          anchor: def.anchor,
          gate: true,
          src: def.interval,
        }));
        break;
      case "supertrend":
        supertrends.push(createSupertrend({
          atrLength: def.atrLength,
          factor: def.factor,
          src: def.interval,
        }));
        break;
      case "ema":
        emas.push(createEma(
          { ...existing, vwaps: [...existing.vwaps, ...vwaps], emas: [...existing.emas, ...emas] },
          { length: def.length, source: def.source, src: def.interval },
        ));
        break;
      default:
        // A type with no chart overlay yet is simply not drawn.
        break;
    }
  }
  return { vwaps, supertrends, emas };
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
    supertrends: [],
    emas: [],
  };
}

/**
 * Source candles the visible runtime-faithful instances need for a chart
 * whose first candle opens at `firstMs`: a gate VWAP from its anchor start,
 * a Supertrend from its warm-up start.
 */
function sourceRequests(
  config: ChartIndicatorsConfig,
  firstMs: number,
): { interval: FeatureIndicatorInterval; startTime: number }[] {
  const requests: { interval: FeatureIndicatorInterval; startTime: number }[] = [];
  for (const item of config.vwaps) {
    const source = vwapSource(item);
    if (!item.visible || !source || item.anchor === "all" || item.anchor === "entry" || item.anchor === "vpoint") {
      continue;
    }
    requests.push({ interval: source, startTime: indicators.math.vwap.anchorStartMs(firstMs, item.anchor) });
  }
  for (const item of config.emas) {
    if (!item.visible || !item.src) continue;
    requests.push({
      interval: item.src,
      startTime: indicators.registry.definitions.ema.state.warmupStartMs(
        { id: item.id, type: "ema", interval: item.src, length: item.length, source: item.source },
        firstMs,
      ),
    });
  }
  for (const item of config.supertrends) {
    if (!item.visible || !item.src) continue;
    requests.push({
      interval: item.src,
      startTime: indicators.registry.definitions.supertrend.state.warmupStartMs(
        { id: item.id, type: "supertrend", interval: item.src, atrLength: item.atrLength, factor: item.factor },
        firstMs,
      ),
    });
  }
  return requests;
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
      supertrends: Array.isArray(parsed?.t)
        ? parsed.t
            .map(decodeSupertrend)
            .filter((item: SupertrendChartConfig | undefined) => item)
        : [],
      emas: Array.isArray(parsed?.m)
        ? parsed.m
            .map(decodeEma)
            .filter((item: EmaChartConfig | undefined) => item)
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
          ...(item.src ? { s: item.src } : {}),
        })),
        t: config.supertrends.map((item) => ({
          i: item.id,
          ...(item.visible ? {} : { h: 1 }),
          l: item.atrLength,
          f: item.factor,
          ...(item.src ? { s: item.src } : {}),
        })),
        m: config.emas.map((item) => ({
          i: item.id,
          ...(item.visible ? {} : { h: 1 }),
          l: item.length,
          ...(item.source === "close" ? {} : { o: item.source }),
          c: item.color,
          ...(item.src ? { s: item.src } : {}),
        })),
      }),
    );
  } catch {
    // localStorage unavailable — config simply won't persist.
  }
}

const chartIndicators = {
  DEFAULT: DEFAULT_CONFIG,
  ema: {
    create: createEma,
    label: emaLabel,
    sources: EMA_SOURCES,
  },
  fromDefs,
  hasDef,
  load,
  sourceRequests,
  save,
  supertrend: {
    create: createSupertrend,
    label: supertrendLabel,
  },
  vwap: {
    create: createVwap,
    label: vwapLabel,
    matchesGate,
    parseBands,
    source: vwapSource,
  },
};

export default chartIndicators;
