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

/** Grouped production vPoint utilities. */
const vpoints = {
  retainRecent,
};

export default vpoints;
