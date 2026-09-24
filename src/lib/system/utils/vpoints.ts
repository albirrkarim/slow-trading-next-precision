import md5 from "md5";
import moment from "moment";
import {
  VOLATILITY_RETRACE_PERCENT,
  VOLATILITY_THRESHOLD,
} from "../constants";
import type { Position } from "../trading";
import type { Kline, VolatilityPoint } from "../types";

/**
 * Memory object used by the predictor. Can be persisted between runs.
 */
interface PredictorMemory {
  // last confirmed pivot (price/time)
  lastPivotPrice: number;
  lastPivotTime: number;

  // local extremes while scanning for active sequences
  localMaxPrice: number;
  localMaxTime: number;
  localMinPrice: number;
  localMinTime: number;

  // active scanning state: null | "UP" | "DOWN"
  active: null | "UP" | "DOWN";

  // parameters (kept in memory to make predictor self-contained)
  moveThreshold: number; // percent to activate UP/DOWN
  retracePercent: number; // percent retrace to mark pivot
}

/**
 * Creates initial predictor memory state for volatility point detection.
 */
function createPredictorMemory(
  firstClose: number,
  firstTime: number,
  moveThreshold = VOLATILITY_THRESHOLD,
  retracePercent = VOLATILITY_RETRACE_PERCENT,
): PredictorMemory {
  return {
    lastPivotPrice: firstClose,
    lastPivotTime: firstTime,

    localMaxPrice: firstClose,
    localMaxTime: firstTime,
    localMinPrice: firstClose,
    localMinTime: firstTime,

    active: null,

    moveThreshold,
    retracePercent,
  };
}

function makeVolatilityId(prefix: string, time: number, symbol?: string) {
  const a = moment(time).format("DD_MM_YY_HH_mm");
  const hashInput = symbol ? `${symbol}:${a}` : a;
  return `${prefix}_${md5(hashInput).substring(0, 3)}_${a}`;
}

/**
 * Processes a single kline to detect volatility points (TOP/BOTTOM markers).
 *
 * Stateless except for the memory object, which is copied immutably.
 */
function predict(
  kline: Kline,
  memory: PredictorMemory,
  symbol?: string,
): { memory: PredictorMemory; point?: VolatilityPoint } {
  // copy memory (immutable style) so we don't mutate caller's object unintentionally
  const mem: PredictorMemory = { ...memory };

  const time = kline[0];
  const close = parseFloat(kline[4]);

  // update local extremes
  if (close > mem.localMaxPrice) {
    mem.localMaxPrice = close;
    mem.localMaxTime = time;
  }
  if (close < mem.localMinPrice) {
    mem.localMinPrice = close;
    mem.localMinTime = time;
  }

  // percent change relative to last pivot
  const pctFromPivot =
    ((close - mem.lastPivotPrice) / mem.lastPivotPrice) * 100;

  // No active sequence: check activation
  if (mem.active === null) {
    if (pctFromPivot >= mem.moveThreshold) {
      mem.active = "UP";
      // ensure localMax includes current
      if (close > mem.localMaxPrice) {
        mem.localMaxPrice = close;
        mem.localMaxTime = time;
      }
      return { memory: mem }; // no pivot yet
    } else if (pctFromPivot <= -mem.moveThreshold) {
      mem.active = "DOWN";
      if (close < mem.localMinPrice) {
        mem.localMinPrice = close;
        mem.localMinTime = time;
      }
      return { memory: mem };
    } else {
      // still idle
      return { memory: mem };
    }
  }

  // Active UP sequence: look for drawdown >= retracePercent to mark TOP
  if (mem.active === "UP") {
    if (close > mem.localMaxPrice) {
      mem.localMaxPrice = close;
      mem.localMaxTime = time;
    }

    const drawdownFromPeak =
      ((mem.localMaxPrice - close) / mem.localMaxPrice) * 100;

    if (drawdownFromPeak >= mem.retracePercent) {
      // Mark TOP at localMax
      const percentage =
        ((mem.localMaxPrice - mem.lastPivotPrice) / mem.lastPivotPrice) * 100;

      // avoid duplicate marking same pivot as previous
      if (
        !(
          mem.localMaxPrice === mem.lastPivotPrice &&
          mem.localMaxTime === mem.lastPivotTime
        )
      ) {
        const point: VolatilityPoint = {
          id: makeVolatilityId("T", mem.localMaxTime, symbol),
          t: mem.localMaxTime,
          l: "T",
          pct: parseFloat(percentage.toFixed(2)),
          p: parseFloat(mem.localMaxPrice.toFixed(8)),
          vb: parseFloat(kline[5]),
          vq: parseFloat(kline[7]),
          lvl: 0,
        };

        // update pivot and reset extremes/active
        mem.lastPivotPrice = mem.localMaxPrice;
        mem.lastPivotTime = mem.localMaxTime;

        mem.localMaxPrice = mem.lastPivotPrice;
        mem.localMaxTime = mem.lastPivotTime;
        mem.localMinPrice = mem.lastPivotPrice;
        mem.localMinTime = mem.lastPivotTime;
        mem.active = null;

        return { memory: mem, point };
      } else {
        // even if duplicate, still reset state and return no point
        mem.localMaxPrice = mem.lastPivotPrice;
        mem.localMaxTime = mem.lastPivotTime;
        mem.localMinPrice = mem.lastPivotPrice;
        mem.localMinTime = mem.lastPivotTime;
        mem.active = null;
        return { memory: mem };
      }
    }

    return { memory: mem };
  }

  // Active DOWN sequence: look for rebound >= retracePercent to mark BOTTOM
  if (mem.active === "DOWN") {
    if (close < mem.localMinPrice) {
      mem.localMinPrice = close;
      mem.localMinTime = time;
    }

    const reboundFromBottom =
      ((close - mem.localMinPrice) / mem.localMinPrice) * 100;

    if (reboundFromBottom >= mem.retracePercent) {
      // Mark BOTTOM at localMin
      const percentage =
        ((mem.lastPivotPrice - mem.localMinPrice) / mem.lastPivotPrice) * 100;

      if (
        !(
          mem.localMinPrice === mem.lastPivotPrice &&
          mem.localMinTime === mem.lastPivotTime
        )
      ) {
        const point: VolatilityPoint = {
          id: makeVolatilityId("B", mem.localMinTime, symbol),
          t: mem.localMinTime,
          l: "B",
          pct: parseFloat(percentage.toFixed(2)),
          p: parseFloat(mem.localMinPrice.toFixed(8)),
          vb: parseFloat(kline[5]),
          vq: parseFloat(kline[7]),
          lvl: 0,
        };

        // update pivot and reset extremes/active
        mem.lastPivotPrice = mem.localMinPrice;
        mem.lastPivotTime = mem.localMinTime;

        mem.localMaxPrice = mem.lastPivotPrice;
        mem.localMaxTime = mem.lastPivotTime;
        mem.localMinPrice = mem.lastPivotPrice;
        mem.localMinTime = mem.lastPivotTime;
        mem.active = null;

        return { memory: mem, point };
      } else {
        mem.localMaxPrice = mem.lastPivotPrice;
        mem.localMaxTime = mem.lastPivotTime;
        mem.localMinPrice = mem.lastPivotPrice;
        mem.localMinTime = mem.lastPivotTime;
        mem.active = null;
        return { memory: mem };
      }
    }

    return { memory: mem };
  }

  // fallback: return memory unchanged
  return { memory: mem };
}

/**
 * Assigns the point's level relative to the previously emitted point.
 * Same-side points deepen the level; a switch resets it.
 */
function assignNextLevel(
  point: VolatilityPoint,
  previousPoint?: VolatilityPoint,
): void {
  if (!previousPoint) {
    point.lvl = point.l === "T" ? 1 : -1;
    return;
  }

  if (previousPoint.l !== point.l) {
    point.lvl = previousPoint.lvl === 0 ? (point.l === "T" ? 1 : -1) : 0;
    return;
  }

  point.lvl = previousPoint.lvl + (point.l === "T" ? 1 : -1);
}

/** Creates the strategy-owned detector memory for the runtime port. */
function createMemory(params: {
  firstClose: number;
  firstTime: number;
  moveThreshold?: number;
  retracePercent?: number;
}): { value: PredictorMemory } {
  return {
    value: createPredictorMemory(
      params.firstClose,
      params.firstTime,
      params.moveThreshold,
      params.retracePercent,
    ),
  };
}

/**
 * Processes one closed kline through the detector and assigns the emitted
 * point's level relative to `previousPoint`.
 */
function processKline(params: {
  kline: Kline;
  memory: { readonly value: unknown };
  previousPoint?: VolatilityPoint;
  symbol: string;
}): {
  memory: { value: PredictorMemory };
  point?: VolatilityPoint;
} {
  const predicted = predict(
    params.kline,
    params.memory.value as PredictorMemory,
    params.symbol,
  );
  const point = predicted.point;
  if (point) {
    assignNextLevel(point, params.previousPoint);
  }

  return {
    memory: { value: predicted.memory },
    point,
  };
}

/**
 * Detects every volatility point over one closed-kline batch through the
 * canonical stream path: same memory and per-kline processing as the runtime
 * port, with levels chained through the emitted points.
 */
function detectVPoints(params: {
  klines: Kline[];
  previousPoint?: VolatilityPoint;
  symbol: string;
  moveThreshold?: number;
  retracePercent?: number;
}): VolatilityPoint[] {
  const { klines, previousPoint, symbol } = params;
  if (klines.length === 0) return [];

  let memory = createMemory({
    firstClose: previousPoint
      ? previousPoint.p
      : parseFloat(klines[0][4]),
    firstTime: previousPoint ? previousPoint.t : klines[0][0],
    moveThreshold: params.moveThreshold,
    retracePercent: params.retracePercent,
  });
  const points: VolatilityPoint[] = [];

  for (let index = 1; index < klines.length; index++) {
    const processed = processKline({
      kline: klines[index],
      memory,
      previousPoint: points.at(-1) ?? previousPoint,
      symbol,
    });
    memory = processed.memory;
    if (processed.point) {
      points.push(processed.point);
    }
  }

  return points;
}

/**
 * Merges two vPoint lists by `id` into one list sorted by `t`. Points present
 * in both keep the `next` version, except `usedBy` markers which union so
 * consumption recorded on either copy is never lost.
 */
function mergeById(
  current: VolatilityPoint[],
  next: VolatilityPoint[],
): VolatilityPoint[] {
  const pointById = new Map<string, VolatilityPoint>();
  for (const point of current) {
    pointById.set(point.id, point);
  }
  for (const point of next) {
    const existing = pointById.get(point.id);
    const merged: VolatilityPoint = { ...existing, ...point };
    const markers = [
      ...(existing?.usedBy ?? []),
      ...(point.usedBy ?? []),
    ];
    // Upgrade persisted `usedBy<slug>` markers from the retired scheme.
    for (const source of [existing, point]) {
      if (!source) continue;
      for (const key of Object.keys(source)) {
        if (
          key !== "usedBy" &&
          key.startsWith("usedBy") &&
          (source as unknown as Record<string, unknown>)[key] === true
        ) {
          markers.push(key.slice("usedBy".length));
          delete (merged as unknown as Record<string, unknown>)[key];
        }
      }
    }
    if (markers.length > 0) {
      merged.usedBy = [...new Set(markers)];
    }
    pointById.set(point.id, merged);
  }
  return [...pointById.values()].sort((left, right) => left.t - right.t);
}

/**
 * Bounds one symbol's vPoint list to a recent window while preserving the
 * dependencies of open positions.
 *
 * A point is retained when it is among the latest `recent` points, occurred at
 * or after the earliest open position's entry time, or is explicitly
 * referenced by an open position's entry/intermediate vPoints:
 *
 * `keep = latestN || point.t >= earliestOpenPositionTime || openPositionReferencesPoint`
 *
 * The entry-time clause is required so post-entry target vPoints survive the
 * window: BOTH:AVERAGING_STOPS_AFTER_TARGET_VPOINT resolves them from the
 * vPoints map, so trimming them would let a position keep averaging after a
 * restart. Usage markers (`usedBy`) ride along on every retained point.
 * Chronological source order is preserved.
 *
 * Passing `Number.POSITIVE_INFINITY` as `recent` retains every point.
 */
function retainRecent(params: {
  symbol: string;
  points: VolatilityPoint[];
  positions: Position[];
  recent: number;
}): VolatilityPoint[] {
  const positions = params.positions.filter(
    (position) =>
      !position.closed &&
      position.symbol.toUpperCase() === params.symbol.toUpperCase(),
  );
  const earliestOpenT = positions.length
    ? Math.min(...positions.map((position) => position.opened.t))
    : undefined;
  const referencedIds = new Set(
    positions.flatMap((position) => [
      position.opened.vPoint.id,
      ...(position.vPoints ?? []).map((point) => point.id),
    ]),
  );

  return params.points.filter(
    (point, index) =>
      index >= Math.max(0, params.points.length - params.recent) ||
      (earliestOpenT !== undefined && point.t >= earliestOpenT) ||
      referencedIds.has(point.id),
  );
}

/** Removes legacy and strategy usage markers from one point. */
function resetUsage(point: VolatilityPoint): void {
  delete point.used;
  delete point.usedBy;
  // Strip persisted markers written by the retired `usedBy<slug>` scheme.
  for (const key of Object.keys(point)) {
    if (key.startsWith("usedBy")) {
      delete (point as VolatilityPoint & Record<string, unknown>)[key];
    }
  }
}

/** Checks whether one marker was recorded on the point. */
function hasUsage(point: VolatilityPoint, marker: string): boolean {
  const normalized = String(marker || "").trim();
  return Boolean(normalized) && (point.usedBy ?? []).includes(normalized);
}

/**
 * Checks whether the point was consumed by one account — either by an exact
 * `"<slug>"` marker or by a per-leg `"<slug>:<ROLE>"` marker.
 */
function hasAccountUsage(
  point: VolatilityPoint,
  accountSlug: string,
): boolean {
  const slug = String(accountSlug || "").trim();
  if (!slug) return false;
  return (point.usedBy ?? []).some(
    (marker) => marker === slug || marker.startsWith(`${slug}:`),
  );
}

/** Records one strategy marker on the point, ignoring duplicates. */
function markUsage(point: VolatilityPoint, marker: string): void {
  const normalized = String(marker || "").trim();
  if (!normalized) return;
  if (!(point.usedBy ??= []).includes(normalized)) {
    point.usedBy.push(normalized);
  }
}

const vpoints = {
  createMemory,
  detectVPoints,
  mergeById,
  processKline,
  resetUsage,
  retainRecent,
  usage: {
    has: hasUsage,
    hasAccount: hasAccountUsage,
    mark: markUsage,
  },
} as const;

export default vpoints;
export type { PredictorMemory };
