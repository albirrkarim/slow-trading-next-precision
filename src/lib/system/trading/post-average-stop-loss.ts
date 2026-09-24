import type {
  Position,
  PostAverageStopLossConfig,
  PostAverageStopLossThreshold,
} from "./types";
import type { VolatilityPoint } from "../types";
import postAverageRescue from "./post-average-rescue";

const DEFAULT_THRESHOLDS: readonly PostAverageStopLossThreshold[] = [
  { maxNetPnlPct: 0, maxNetPnlUsdt: 0, minAveragingCount: 1 },
];

type AveragedPosition = Pick<Position, "strategy">;

/** Creates a disabled, independently mutable default configuration. */
function createDefaultConfig(): PostAverageStopLossConfig {
  return {
    enabled: false,
    thresholds: DEFAULT_THRESHOLDS.map((threshold) => ({ ...threshold })),
  };
}

function normalizeLossBoundary(value: unknown): number {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.min(0, numericValue) : 0;
}

function normalizeDriftBoundary(value: unknown): number {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.max(0, numericValue) : 0;
}

/** Sanitizes persisted or user-edited post-average stop loss configuration. */
function normalizeConfig(
  config?: PostAverageStopLossConfig,
): PostAverageStopLossConfig {
  if (!config) return createDefaultConfig();

  const thresholds = new Map<number, PostAverageStopLossThreshold>();
  for (const threshold of Array.isArray(config.thresholds)
    ? config.thresholds
    : []) {
    const minAveragingCount = Math.max(
      1,
      Math.floor(Number(threshold.minAveragingCount)),
    );
    if (!Number.isFinite(minAveragingCount)) continue;

    thresholds.set(minAveragingCount, {
      adverseDriftPct: normalizeDriftBoundary(threshold.adverseDriftPct),
      maxNetPnlPct: normalizeLossBoundary(threshold.maxNetPnlPct),
      maxNetPnlUsdt: normalizeLossBoundary(threshold.maxNetPnlUsdt),
      minAveragingCount,
    });
  }

  return {
    enabled: config.enabled === true,
    thresholds: [...thresholds.values()].sort(
      (left, right) => left.minAveragingCount - right.minAveragingCount,
    ),
  };
}

/** Selects the greatest configured averaging tier already reached. */
function getThreshold(
  completedAveragingCount: number,
  config?: PostAverageStopLossConfig,
): PostAverageStopLossThreshold | undefined {
  const resolvedConfig = normalizeConfig(config);
  if (!resolvedConfig.enabled) return undefined;

  let selected: PostAverageStopLossThreshold | undefined;
  for (const threshold of resolvedConfig.thresholds) {
    if (threshold.minAveragingCount <= completedAveragingCount) {
      selected = threshold;
    }
  }
  return selected;
}

/**
 * Resolves the adverse-drift anchor: the price of the vPoint latest at the
 * most recent completed averaging execution, falling back to that fill's own
 * price (or the last USED reserve step for legacy positions) when no matching
 * vPoint remains in the window.
 */
function getLastAveragingAnchorPrice(
  position?: AveragedPosition | null,
  volatilityPoints?: VolatilityPoint[],
): number | undefined {
  const averaging = position?.strategy.averaging;
  if (!averaging) return undefined;

  const execution = Array.isArray(averaging.executions)
    ? averaging.executions.at(-1)
    : undefined;
  const usedStep = Array.isArray(averaging.steps)
    ? [...averaging.steps]
        .reverse()
        .find((step) => step.status === "USED")
    : undefined;

  const anchorT = execution?.t ?? usedStep?.usedAt;
  const anchorLevel = execution?.level ?? usedStep?.level;
  const fillPrice = execution?.price ?? usedStep?.usedPrice;

  const eligible = (volatilityPoints ?? []).filter(
    (point) =>
      Number.isFinite(point?.t) &&
      anchorT !== undefined &&
      point.t <= anchorT,
  );
  const vPoint =
    [...eligible].reverse().find((point) => point.lvl === anchorLevel) ??
    eligible.at(-1);

  const anchorPrice = vPoint?.p ?? fillPrice;
  return typeof anchorPrice === "number" &&
    Number.isFinite(anchorPrice) &&
    anchorPrice > 0
    ? anchorPrice
    : undefined;
}

/**
 * Evaluates independent fee-aware percent, USDT, and last-averaging vPoint
 * adverse-drift loss boundaries.
 */
function evaluate({
  config,
  currentPrice,
  direction,
  netPnlPercent,
  netPnlUsdt,
  position,
  volatilityPoints,
}: {
  config?: PostAverageStopLossConfig;
  currentPrice?: number;
  direction?: Position["direction"];
  netPnlPercent: number;
  netPnlUsdt: number;
  position?: AveragedPosition | null;
  volatilityPoints?: VolatilityPoint[];
}) {
  const completedAveragingCount =
    postAverageRescue.averaging.countCompleted(position);
  const threshold = getThreshold(completedAveragingCount, config);
  const percentEnabled = (threshold?.maxNetPnlPct ?? 0) < 0;
  const usdtEnabled = (threshold?.maxNetPnlUsdt ?? 0) < 0;
  const driftBoundary = Math.max(0, threshold?.adverseDriftPct ?? 0);
  const driftEnabled = driftBoundary > 0;
  const anchorPrice = driftEnabled
    ? getLastAveragingAnchorPrice(position, volatilityPoints)
    : undefined;
  const adverseDriftPct =
    anchorPrice === undefined
      ? 0
      : -postAverageRescue.distance.calculateFavorablePercent({
          currentPrice: currentPrice ?? 0,
          direction,
          lastVolatilityPrice: anchorPrice,
        });
  const hitPercent =
    percentEnabled && netPnlPercent <= (threshold?.maxNetPnlPct ?? 0);
  const hitUsdt = usdtEnabled && netPnlUsdt <= (threshold?.maxNetPnlUsdt ?? 0);
  const hitDrift = driftEnabled && adverseDriftPct >= driftBoundary;

  return {
    adverseDriftPct,
    anchorPrice,
    completedAveragingCount,
    hitDrift,
    hitPercent,
    hitUsdt,
    shouldExit: hitPercent || hitUsdt || hitDrift,
    threshold,
  };
}

const postAverageStopLoss = {
  anchor: {
    getLastPrice: getLastAveragingAnchorPrice,
  },
  config: {
    createDefault: createDefaultConfig,
    normalize: normalizeConfig,
  },
  evaluate,
  threshold: {
    get: getThreshold,
  },
} as const;

export default postAverageStopLoss;
