import type { VolatilityPoint } from "@/lib/system/types";
import { runtimeEntrySequences } from "@/lib/system/trading";

export interface VPointLevelFrequency {
  count: number;
  level: number;
}

export interface VPointLevelProgression {
  direction: "down" | "up";
  exactPct: number;
  pct: number;
  targetCount: number;
  targetLevel: number;
}

export interface VPointPctMetrics {
  avg: number | null;
  max: number | null;
  min: number | null;
}

export interface VPointLevelMaxDrawdown extends VPointPctMetrics {
  count: number;
  targetLevels: number[];
}

export interface RangedVPointsSummary {
  frequencies: VPointLevelFrequency[];
  pct: VPointPctMetrics;
  total: number;
}

/** Returns all vPoints inside the selected dashboard time range. */
function getRangedVPoints({
  endTime,
  startTime,
  volatilityMap,
}: {
  endTime?: number;
  startTime?: number;
  volatilityMap: Record<string, VolatilityPoint[]>;
}): VolatilityPoint[] {
  const rangedVolatilityMap = runtimeEntrySequences.range.crop({
    endTimeMs: endTime,
    startTimeMs: startTime,
    volatilityMap,
  });
  return Object.values(rangedVolatilityMap).flat();
}

/** Summarizes an already ranged collection of vPoints. */
function summarizeVPoints(points: VolatilityPoint[]): RangedVPointsSummary {
  const countByLevel = new Map<number, number>();
  const pctValues: number[] = [];

  for (const point of points) {
    if (Number.isFinite(point.pct)) pctValues.push(point.pct);
    if (!Number.isInteger(point.lvl)) continue;
    countByLevel.set(point.lvl, (countByLevel.get(point.lvl) ?? 0) + 1);
  }

  const observedLevels = [...countByLevel.keys()];
  const frequencies: VPointLevelFrequency[] = [];

  if (observedLevels.length > 0) {
    const maximumLevel = Math.max(...observedLevels);
    const minimumLevel = Math.min(...observedLevels);

    frequencies.push(
      ...Array.from(
        { length: maximumLevel - minimumLevel + 1 },
        (_, index) => {
          const level = maximumLevel - index;
          return { count: countByLevel.get(level) ?? 0, level };
        },
      ),
    );
  }

  return {
    frequencies,
    pct: {
      avg:
        pctValues.length > 0
          ? pctValues.reduce((sum, pct) => sum + pct, 0) / pctValues.length
          : null,
      max: pctValues.length > 0 ? Math.max(...pctValues) : null,
      min: pctValues.length > 0 ? Math.min(...pctValues) : null,
    },
    total: points.length,
  };
}

/** Summarizes each level's next outward-level pct values as drawdown samples. */
export function summarizeVPointLevelMaxDrawdowns(
  points: Pick<VolatilityPoint, "lvl" | "pct">[],
): Map<number, VPointLevelMaxDrawdown> {
  const valuesBySourceLevel = new Map<number, number[]>();

  for (const point of points) {
    if (
      !Number.isInteger(point.lvl) ||
      point.lvl === 0 ||
      !Number.isFinite(point.pct)
    ) {
      continue;
    }

    const sourceLevel = point.lvl > 0 ? point.lvl - 1 : point.lvl + 1;
    const current = valuesBySourceLevel.get(sourceLevel) ?? [];
    current.push(point.pct);
    valuesBySourceLevel.set(sourceLevel, current);
  }

  return new Map(
    [...valuesBySourceLevel.entries()].map(
      ([sourceLevel, values]) => [
        sourceLevel,
        {
          avg: values.reduce((sum, value) => sum + value, 0) / values.length,
          count: values.length,
          max: Math.max(...values),
          min: Math.min(...values),
          targetLevels:
            sourceLevel === 0
              ? [1, -1]
              : [sourceLevel + (sourceLevel > 0 ? 1 : -1)],
        },
      ],
    ),
  );
}

/** Explains which outward vPoint pct samples feed one level's Max DD. */
export function buildVPointLevelMaxDrawdownTooltip(
  level: number,
  metric?: VPointLevelMaxDrawdown,
): string {
  const defaultTargetLevels =
    level === 0 ? [1, -1] : [level + (level > 0 ? 1 : -1)];
  const targetLevels = metric?.targetLevels.length
    ? metric.targetLevels
    : defaultTargetLevels;
  const targetLabel = targetLevels
    .map((targetLevel) => `Level ${targetLevel}`)
    .join(" and ");
  const sampleLabel = metric
    ? `the ${metric.count.toLocaleString()} matching vPoint${metric.count === 1 ? "" : "s"}`
    : "no matching vPoints because none are available";

  return `Level ${level} Max DD uses pct from ${targetLabel} vPoints in the selected range. Each pct is the price-movement magnitude from the preceding pivot to that outward level. Max, avg, and min summarize ${sampleLabel}.`;
}

/** Calculates the whole-percent progression from one level to the next. */
export function calculateVPointLevelProgressionPct({
  count,
  lowerCount,
}: {
  count: number;
  lowerCount: number;
}): number | null {
  if (
    !Number.isFinite(count) ||
    count < 0 ||
    !Number.isFinite(lowerCount) ||
    lowerCount <= 0
  ) {
    return null;
  }

  return Math.floor((count / lowerCount) * 100);
}

/** Calculates a level row's proportional heat-map width. */
export function calculateVPointLevelHeatPct({
  count,
  maximumCount,
}: {
  count: number;
  maximumCount: number;
}): number {
  if (
    !Number.isFinite(count) ||
    count <= 0 ||
    !Number.isFinite(maximumCount) ||
    maximumCount <= 0
  ) {
    return 0;
  }

  return Math.min(100, (count / maximumCount) * 100);
}

/** Builds the outward level progressions available from one vPoint level. */
export function getVPointLevelProgressions({
  countByLevel,
  level,
}: {
  countByLevel: ReadonlyMap<number, number>;
  level: number;
}): VPointLevelProgression[] {
  const count = countByLevel.get(level);
  if (count === undefined) return [];

  const targets = [
    ...(level >= 0
      ? [{ direction: "up" as const, targetLevel: level + 1 }]
      : []),
    ...(level <= 0
      ? [{ direction: "down" as const, targetLevel: level - 1 }]
      : []),
  ];

  return targets.flatMap(({ direction, targetLevel }) => {
    const targetCount = countByLevel.get(targetLevel);
    if (targetCount === undefined) return [];

    const pct = calculateVPointLevelProgressionPct({
      count: targetCount,
      lowerCount: count,
    });
    if (pct === null) return [];

    return [
      {
        direction,
        exactPct: (targetCount / count) * 100,
        pct,
        targetCount,
        targetLevel,
      },
    ];
  });
}

/** Summarizes vPoints within the selected dashboard time range. */
export function summarizeRangedVPoints({
  endTime,
  startTime,
  volatilityMap,
}: {
  endTime?: number;
  startTime?: number;
  volatilityMap: Record<string, VolatilityPoint[]>;
}): RangedVPointsSummary {
  return summarizeVPoints(
    getRangedVPoints({ endTime, startTime, volatilityMap }),
  );
}

/** Counts vPoints in a time range from the highest observed level downward. */
export function countRangedVPointLevelFrequency({
  endTime,
  startTime,
  volatilityMap,
}: {
  endTime?: number;
  startTime?: number;
  volatilityMap: Record<string, VolatilityPoint[]>;
}): VPointLevelFrequency[] {
  return summarizeRangedVPoints({ endTime, startTime, volatilityMap })
    .frequencies;
}

export function formatVPointPct(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(2)}%`;
}

export function formatLevelMaxDrawdown(metric?: VPointLevelMaxDrawdown): string {
  if (!metric) return "Max DD —";

  return `Max DD (max: ${formatVPointPct(metric.max)}, avg: ${formatVPointPct(metric.avg)}, min: ${formatVPointPct(metric.min)})`;
}

export { summarizeVPoints };
