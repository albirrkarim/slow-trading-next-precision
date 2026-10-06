/**
 * Anchored VWAP for the chart layer. Cumulative volume-weighted average
 * price (TradingView-style: `hlc3` source) that resets at each anchor
 * boundary, plus optional standard-deviation bands. Pure math over chart
 * candles — no exchange or runtime imports so callers can unit test it
 * and the output drops straight into line series.
 */

export type VwapAnchor =
  | "session"
  | "week"
  | "month"
  | "all"
  | "entry"
  | "vpoint";

export interface VwapCandle {
  /** Chart time in seconds. */
  time: number;
  high: number;
  low: number;
  close: number;
  /** Base volume. */
  volume: number;
}

export interface VwapPoint {
  time: number;
  value: number;
}

export interface VwapSeries {
  vwap: VwapPoint[];
  /** bands[i] pairs with the i-th requested multiplier. */
  upper: VwapPoint[][];
  lower: VwapPoint[][];
}

export interface VwapIndicatorConfig {
  enabled: boolean;
  anchor: VwapAnchor;
  /** Std-dev multipliers for the band envelope, e.g. [1, 2]. */
  bands: number[];
}

const DAY_MS = 24 * 60 * 60_000;
const WEEK_MS = 7 * DAY_MS;

/**
 * Bucket key per candle: candles sharing a key accumulate into the same
 * VWAP run. `-1` means "exclude the candle" (entry anchor not reached).
 * Session/week/month use UTC boundaries since crypto trades 24/7; "vpoint"
 * buckets by the pivot boundaries the caller supplies.
 */
function anchorKey(
  timeMs: number,
  anchor: VwapAnchor,
  opts: { anchorTimeMs?: number; boundariesMs?: number[] },
): number {
  switch (anchor) {
    case "all":
      return 0;
    case "entry":
      return opts.anchorTimeMs !== undefined && timeMs >= opts.anchorTimeMs
        ? 0
        : -1;
    case "vpoint": {
      // Bucket = count of pivots at/before the candle — each pivot opens a
      // new accumulation run, so the line tracks one volatility wave.
      const boundaries = opts.boundariesMs;
      if (!boundaries?.length) return 0;
      let lo = 0;
      let hi = boundaries.length;
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (boundaries[mid] <= timeMs) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    }
    case "session":
      return Math.floor(timeMs / DAY_MS);
    case "week":
      // Epoch fell on a Thursday — shift by 4d so buckets open Monday UTC.
      return Math.floor((timeMs - 4 * DAY_MS) / WEEK_MS);
    case "month": {
      const d = new Date(timeMs);
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    }
    default:
      return -1;
  }
}

/**
 * Computes the anchored VWAP line and stdev bands over chart candles.
 * VWAP = Σ(hlc3 × volume) / Σvolume since the last anchor boundary;
 * each band = vwap ± mult × σ where σ is the cumulative population
 * standard deviation of hlc3 since the same boundary
 * (`sqrt(Σsrc²/n − (Σsrc/n)²)` — TradingView's method). Candles with
 * non-positive volume extend the line unchanged (they move nothing).
 */
function compute(
  candles: VwapCandle[],
  {
    anchor,
    anchorTimeMs,
    boundariesMs,
    bands = [],
  }: {
    anchor: VwapAnchor;
    /** ms epoch; required for the "entry" anchor. */
    anchorTimeMs?: number;
    /** Sorted pivot times (ms); drives the "vpoint" anchor. */
    boundariesMs?: number[];
    bands?: number[];
  },
): VwapSeries {
  const vwap: VwapPoint[] = [];
  const upper = bands.map(() => [] as VwapPoint[]);
  const lower = bands.map(() => [] as VwapPoint[]);

  let currentKey: number | null = null;
  let pv = 0;
  let v = 0;
  let sumSrc = 0;
  let sumSrcSq = 0;
  let n = 0;
  const boundaries =
    boundariesMs && boundariesMs.length > 1
      ? [...boundariesMs].sort((a, b) => a - b)
      : boundariesMs;

  for (const candle of candles) {
    const key = anchorKey(candle.time * 1000, anchor, {
      anchorTimeMs,
      boundariesMs: boundaries,
    });
    if (key === -1) continue;

    if (key !== currentKey) {
      currentKey = key;
      pv = 0;
      v = 0;
      sumSrc = 0;
      sumSrcSq = 0;
      n = 0;
    }

    const src = (candle.high + candle.low + candle.close) / 3;
    n += 1;
    sumSrc += src;
    sumSrcSq += src * src;

    const vol = candle.volume;
    if (Number.isFinite(vol) && vol > 0) {
      pv += src * vol;
      v += vol;
    }

    if (v <= 0) continue;

    const value = pv / v;
    const variance = Math.max(sumSrcSq / n - (sumSrc / n) ** 2, 0);
    const stdev = Math.sqrt(variance);

    vwap.push({ time: candle.time, value });
    bands.forEach((mult, i) => {
      upper[i].push({ time: candle.time, value: value + mult * stdev });
      lower[i].push({ time: candle.time, value: value - mult * stdev });
    });
  }

  return { vwap, upper, lower };
}

const STORAGE_KEY = "precision:trade-chart-vwap:v1";

const DEFAULT_CONFIG: VwapIndicatorConfig = {
  enabled: false,
  anchor: "session",
  bands: [1, 2],
};

const ANCHORS: VwapAnchor[] = [
  "session",
  "week",
  "month",
  "all",
  "entry",
  "vpoint",
];

/**
 * Reads the persisted indicator config; falls back to defaults on absent
 * or malformed storage so a bad blob never breaks the chart.
 */
function loadConfig(): VwapIndicatorConfig {
  try {
    if (typeof window === "undefined") return DEFAULT_CONFIG;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw);
    return {
      enabled: parsed?.e === true,
      anchor: ANCHORS.includes(parsed?.a) ? parsed.a : DEFAULT_CONFIG.anchor,
      bands:
        Array.isArray(parsed?.b) &&
        parsed.b.every((x: unknown) => Number.isFinite(x))
          ? parsed.b
          : DEFAULT_CONFIG.bands,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

/** Persists the indicator config (compact keys — UI preference only). */
function saveConfig(config: VwapIndicatorConfig) {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ e: config.enabled, a: config.anchor, b: config.bands }),
    );
  } catch {
    // localStorage unavailable — config simply won't persist.
  }
}

const vwap = {
  compute,
  config: {
    DEFAULT: DEFAULT_CONFIG,
    load: loadConfig,
    save: saveConfig,
  },
};

export default vwap;
