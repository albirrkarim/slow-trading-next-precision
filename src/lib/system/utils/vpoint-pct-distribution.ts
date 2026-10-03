import type { VolatilityPoint } from "../types";

export interface VPointPctDistributionOccurrence {
  id?: string;
  lvl: number;
  pct: number;
  symbol?: string;
  t?: number;
}

export interface VPointPctDistributionBucket {
  count: number;
  label: string;
  maxPct: number;
  minPct: number;
  /** Details retained only for points at or above the detail threshold. */
  occurrences?: VPointPctDistributionOccurrence[];
}

const DEFAULT_INTERVAL = 5;
const MINIMUM_INTERVAL = 0.1;
const DEFAULT_DETAIL_PCT = 15;
const MINIMUM_DETAIL_PCT = 0;

/** Normalizes the percentage interval used by the vPoint distribution. */
function normalizeInterval(value: number): number {
  return Number.isFinite(value) && value >= MINIMUM_INTERVAL
    ? value
    : DEFAULT_INTERVAL;
}

/** Normalizes the percentage above which bucket members keep their details. */
function normalizeDetailPct(value: number): number {
  return Number.isFinite(value) && value >= MINIMUM_DETAIL_PCT
    ? value
    : DEFAULT_DETAIL_PCT;
}

function getDecimalPlaces(interval: number): number {
  return Math.min(
    6,
    Math.max(0, (String(interval).split(".")[1] ?? "").length),
  );
}

function roundBoundary(value: number, interval: number): number {
  return Number(value.toFixed(getDecimalPlaces(interval)));
}

/** Counts finite vPoint percentages in occupied half-open ranges. */
function compute(
  points: VolatilityPoint[],
  intervalInput: number,
  detailPctInput?: number,
): VPointPctDistributionBucket[] {
  // BOTH:VPOINT_PCT_DISTRIBUTION
  const interval = normalizeInterval(intervalInput);
  const detailPct = normalizeDetailPct(detailPctInput ?? NaN);
  const counts = new Map<
    number,
    { count: number; occurrences?: VPointPctDistributionOccurrence[] }
  >();

  for (const point of points) {
    if (!Number.isFinite(point.pct)) continue;
    const bucketIndex = Math.floor(
      (point.pct + Number.EPSILON * 100) / interval,
    );
    const current = counts.get(bucketIndex);
    const occurrence = {
      ...(String(point.id ?? "").trim() ? { id: String(point.id).trim() } : {}),
      lvl: point.lvl,
      pct: point.pct,
      ...(String(point.symbol ?? "").trim()
        ? { symbol: String(point.symbol).trim() }
        : {}),
      ...(Number.isFinite(point.t) ? { t: point.t } : {}),
    };
    if (!current) {
      counts.set(bucketIndex, {
        count: 1,
        ...(occurrence.pct >= detailPct
          ? { occurrences: [occurrence] }
          : {}),
      });
      continue;
    }

    counts.set(bucketIndex, {
      count: current.count + 1,
      occurrences:
        occurrence.pct >= detailPct
          ? [...(current.occurrences ?? []), occurrence]
          : current.occurrences,
    });
  }

  return [...counts.entries()]
    .sort(([left], [right]) => left - right)
    .map(([bucketIndex, bucket]) => {
      const minPct = roundBoundary(bucketIndex * interval, interval);
      const maxPct = roundBoundary(minPct + interval, interval);
      return {
        count: bucket.count,
        label: `${minPct} – ${maxPct}%`,
        maxPct,
        minPct,
        ...(bucket.occurrences?.length
          ? {
              occurrences: [...bucket.occurrences].sort(
                (left, right) => (left.t ?? 0) - (right.t ?? 0),
              ),
            }
          : {}),
      };
    });
}

const vPointPctDistribution = {
  compute,
  detailPct: {
    defaultValue: DEFAULT_DETAIL_PCT,
    minimum: MINIMUM_DETAIL_PCT,
    normalize: normalizeDetailPct,
  },
  interval: {
    defaultValue: DEFAULT_INTERVAL,
    minimum: MINIMUM_INTERVAL,
    normalize: normalizeInterval,
  },
};

export default vPointPctDistribution;
