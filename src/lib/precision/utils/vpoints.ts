import type { VolatilityPoint } from "@/lib/dynamic";
import type { Position } from "@/lib/trading/models";

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
 * restart. Account usage markers (`usedBy<accountSlug>`) ride along on every
 * retained point. Chronological source order is preserved.
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

/**
 * Merges two vPoint lists by `id` into one list sorted by `t`. Points present
 * in both keep the `next` version, so later mutations such as
 * `usedBy<accountSlug>` markers overwrite the older copy.
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
    pointById.set(point.id, { ...pointById.get(point.id), ...point });
  }
  return [...pointById.values()].sort((left, right) => left.t - right.t);
}

/** Grouped vPoint utilities shared by the runtime and its adapters. */
const vpoints = {
  retainRecent,
  mergeById,
};

export default vpoints;
