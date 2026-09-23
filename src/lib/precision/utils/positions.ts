import type { RuntimeContext } from "../types";
import { pnl } from "@/lib/system/trading";
import type {
  AveragingRecommendation,
  EntryRecommendation,
  Position,
  PositionPnlPoint,
} from "@/lib/system/trading";
import type { VolatilityPoint } from "@/lib/system/types";
import { VOLATILITY_THRESHOLD } from "@/lib/system/constants";

const MAX_HISTORY_POINTS = 24 * 90;
const MINUTE_MS = 60 * 1000;
const DEFAULT_PNL_HISTORY_BUCKET_MINUTES = 60;

const DEFAULT_SPEEDUP_POSITIVE_PNL_THRESHOLD_PCT = 1.5;
const DEFAULT_SPEEDUP_NEGATIVE_PNL_THRESHOLD_PCT = 1.5;
const DEFAULT_SPEEDUP_TAKE_PROFIT_OFFSET_PCT = 0.5;

type SpeedupStageReason =
  | "POSITIVE_PNL_THRESHOLD"
  | "NEGATIVE_PNL_THRESHOLD"
  | "STOP_LOSS_PLUS_ARMED"
  | "NEAR_TAKE_PROFIT"
  | "POST_AVERAGE_TARGET_APPROACH"
  | "TARGET_VPOINT_HIT";

const SPEEDUP_REASON_LABELS: Record<SpeedupStageReason, string> = {
  POSITIVE_PNL_THRESHOLD: "positive PnL threshold",
  NEGATIVE_PNL_THRESHOLD: "negative PnL threshold",
  STOP_LOSS_PLUS_ARMED: "StopLoss+ armed",
  NEAR_TAKE_PROFIT: "near take profit",
  POST_AVERAGE_TARGET_APPROACH: "post-average target approach",
  TARGET_VPOINT_HIT: "target vPoint hit",
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function roundPct(value: number): number {
  return Number(value.toFixed(3));
}

function roundUsdt(value: number): number {
  return Number(value.toFixed(6));
}

/** Normalizes the configured PnL-history bucket to whole positive minutes. */
function normalizeBucketMinutes(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_PNL_HISTORY_BUCKET_MINUTES;
  }

  return Math.max(1, Math.floor(parsed));
}

/** Resolves the configured PnL-history bucket to milliseconds. */
function resolveBucketMs(value: unknown): number {
  return normalizeBucketMinutes(value) * MINUTE_MS;
}

/** Normalizes persisted history points into the canonical `{t, pct}` shape. */
function normalizeHistoryPoints(raw: unknown): PositionPnlPoint[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((item) => {
      if (isFiniteNumber(item?.t) && isFiniteNumber(item?.pct)) {
        return {
          t: item.t,
          pct: roundPct(item.pct),
        };
      }

      if (isFiniteNumber(item?.timeMs) && isFiniteNumber(item?.percent)) {
        return {
          t: item.timeMs,
          pct: roundPct(item.percent),
        };
      }

      return null;
    })
    .filter((item): item is PositionPnlPoint => item !== null)
    .sort((a, b) => a.t - b.t);
}

/** Upserts a history point, optionally replacing within the same bucket. */
function upsertHistoryPoint(
  history: PositionPnlPoint[],
  point: PositionPnlPoint,
  replaceWithinBucket: boolean,
  bucketMs = resolveBucketMs(undefined),
): PositionPnlPoint[] {
  if (!isFiniteNumber(point.t) || !isFiniteNumber(point.pct)) {
    return history;
  }

  if (history.length === 0) {
    return [point];
  }

  const next = [...history].sort((a, b) => a.t - b.t);
  const last = next.at(-1);
  if (!last) {
    return [point];
  }

  if (replaceWithinBucket) {
    const lastBucket = Math.floor(last.t / bucketMs);
    const nextBucket = Math.floor(point.t / bucketMs);

    if (lastBucket === nextBucket) {
      next[next.length - 1] = point;
    } else if (point.t > last.t) {
      next.push(point);
    }
  } else {
    const existingIndex = next.findIndex((item) => item.t === point.t);
    if (existingIndex >= 0) {
      next[existingIndex] = point;
    } else {
      next.push(point);
    }
  }

  next.sort((a, b) => a.t - b.t);
  if (next.length > MAX_HISTORY_POINTS) {
    return next.slice(next.length - MAX_HISTORY_POINTS);
  }

  return next;
}

/** Applies the fee estimate used by floating PnL. */
function applyFloatingFeeEstimate(
  position: Position,
  roundTripFeeRatio: number,
): void {
  const entryNotional = Number(position.exposure.notionalUsdt) || 0;
  if (!(entryNotional > 0) || !(roundTripFeeRatio > 0)) {
    return;
  }

  const estimatedTotalFee = entryNotional * roundTripFeeRatio;
  const entryFee =
    isFiniteNumber(position.fees.entryUsdt) &&
    position.fees.entryUsdt >= 0
      ? position.fees.entryUsdt
      : estimatedTotalFee / 2;
  const exitFee = Math.max(0, estimatedTotalFee - entryFee);

  position.fees.entryUsdt = roundUsdt(entryFee);
  position.fees.estimatedExitUsdt = roundUsdt(exitFee);
}

/** Updates fee-aware PnL and its bounded configured history bucket. */
function updatePnl(context: RuntimeContext, position: Position): void {
  const markPrice = context.state.markPriceMap[position.symbol.toUpperCase()];
  if (!markPrice) {
    throw new Error(`Runtime mark price not found for ${position.symbol}.`);
  }

  const roundTripFeeRatio = context.adapter.exchange.getRoundTripFeeRate({
    type: "taker",
  });
  const metrics = pnl.computeClosedMetrics(
    position,
    markPrice.price,
    roundTripFeeRatio,
  );
  if (!metrics) {
    return;
  }

  position.pnl.netPct = metrics.netProfitPercent;
  position.pnl.netUsdt = metrics.netProfitUSDT;
  // BOTH:POSITION_PNL_USDT_EXTREMA
  pnl.applyNetUsdtExtrema(position, metrics.netProfitUSDT);
  position.pnl.currentValueUsdt = metrics.netCurrentUSDT;
  position.pnl.markPrice = markPrice.price;
  applyFloatingFeeEstimate(position, roundTripFeeRatio);

  // PROD:MONITORING_OPEN_POSITION
  position.pnl.history = normalizeHistoryPoints(position.pnl.history);
  const observationPct = position.pnl.netPct ?? 0;
  position.pnl.history = upsertHistoryPoint(
    position.pnl.history,
    {
      t: context.state.currentTime,
      pct: roundPct(observationPct),
    },
    true,
    resolveBucketMs(context.state.config.runtime.pnlHistoryBucketMinutes),
  );

  position.pnl.maxUpPct = isFiniteNumber(position.pnl.maxUpPct)
    ? roundPct(Math.max(position.pnl.maxUpPct, observationPct))
    : roundPct(observationPct);
  position.pnl.maxDownPct = isFiniteNumber(position.pnl.maxDownPct)
    ? roundPct(Math.min(position.pnl.maxDownPct, observationPct))
    : roundPct(observationPct);
}

/** Formats all matching Speedup reasons for persisted diagnostics and UI. */
function describeSpeedupReasons(reasons: SpeedupStageReason[]): string {
  if (reasons.length === 0) {
    return "No Speedup rule matched";
  }

  return reasons.map((reason) => SPEEDUP_REASON_LABELS[reason]).join(", ");
}

/** Normalizes a non-negative percentage used by Speedup classification. */
function normalizeSpeedupPercent(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(0, parsed);
}

/** Explains why a position remains in Standard using canonical persisted PnL. */
function describeStandardReason(params: {
  negativePnlThresholdPct?: number;
  positivePnlThresholdPct?: number;
  position: Position;
}): string {
  const netPct = Number(params.position.pnl.netPct);
  const netPctLabel = Number.isFinite(netPct) ? `${netPct}%` : "unavailable";
  const positiveThresholdPct = normalizeSpeedupPercent(
    params.positivePnlThresholdPct,
    DEFAULT_SPEEDUP_POSITIVE_PNL_THRESHOLD_PCT,
  );
  const negativeThresholdPct = normalizeSpeedupPercent(
    params.negativePnlThresholdPct,
    DEFAULT_SPEEDUP_NEGATIVE_PNL_THRESHOLD_PCT,
  );

  return (
    `No Speedup rule matched: canonical net PnL ${netPctLabel}; ` +
    `PnL rules require >= +${positiveThresholdPct}% or <= -${negativeThresholdPct}%`
  );
}

/** Finds the first post-entry target vPoint reached by a position. */
function findPositionTargetVolatilityPoint<
  TPoint extends Pick<VolatilityPoint, "l" | "t">,
>(params: {
  position: Pick<Position, "direction" | "opened">;
  volatilityPoints: TPoint[];
}): TPoint | undefined {
  // BOTH:AVERAGING_STOPS_AFTER_TARGET_VPOINT
  const targetLabel = params.position.direction === "SHORT" ? "B" : "T";
  const entryTime = params.position.opened.t ?? 0;

  return params.volatilityPoints.reduce<TPoint | undefined>(
    (firstTarget, point) => {
      if (point.l !== targetLabel || point.t < entryTime) {
        return firstTarget;
      }

      return !firstTarget || point.t < firstTarget.t ? point : firstTarget;
    },
    undefined,
  );
}

/** Checks whether a position has reached its post-entry target vPoint. */
function hasPositionHitTargetVolatilityPoint(params: {
  position: Pick<Position, "direction" | "opened">;
  volatilityPoints: Array<Pick<VolatilityPoint, "l" | "t">>;
}): boolean {
  return Boolean(findPositionTargetVolatilityPoint(params));
}

/** Calculates favorable price distance from the latest vPoint. */
function calculateFavorableDistancePercent({
  currentPrice,
  direction,
  lastVolatilityPrice,
}: {
  currentPrice: number;
  direction?: Position["direction"];
  lastVolatilityPrice?: number;
}) {
  if (
    !(
      typeof currentPrice === "number" &&
      Number.isFinite(currentPrice) &&
      currentPrice > 0
    ) ||
    !(
      typeof lastVolatilityPrice === "number" &&
      Number.isFinite(lastVolatilityPrice) &&
      lastVolatilityPrice > 0
    )
  ) {
    return 0;
  }

  if (direction === "SHORT") {
    return ((lastVolatilityPrice - currentPrice) / lastVolatilityPrice) * 100;
  }

  return ((currentPrice - lastVolatilityPrice) / lastVolatilityPrice) * 100;
}

/** Returns whether an averaged position is approaching its target vPoint. */
function isApproachingPostAverageTarget(params: {
  latestVolatilityPoint?: Pick<VolatilityPoint, "p">;
  position: Position;
  volatilityThresholdPct?: number;
}): boolean {
  const averagingExecutions = params.position.strategy.averaging.executions;
  if (!averagingExecutions?.length) {
    return false;
  }

  const volatilityThresholdPct = Number(
    params.volatilityThresholdPct ?? VOLATILITY_THRESHOLD,
  );
  if (!Number.isFinite(volatilityThresholdPct)) {
    return false;
  }

  const favorableDistancePct = calculateFavorableDistancePercent({
    currentPrice: Number(params.position.pnl.markPrice),
    direction: params.position.direction,
    lastVolatilityPrice: Number(params.latestVolatilityPoint?.p),
  });

  return favorableDistancePct > Math.max(0, volatilityThresholdPct) / 2;
}

/** Returns the reasons that currently place a position in Speedup. */
function getSpeedupReasons(params: {
  latestVolatilityPoint?: Pick<VolatilityPoint, "p">;
  negativePnlThresholdPct?: number;
  positivePnlThresholdPct?: number;
  position: Position;
  takeProfitOffsetPct?: number;
  takeProfitPercent?: number;
  useStopLossPlus?: boolean;
  volatilityPoints?: Array<Pick<VolatilityPoint, "l" | "t">>;
  volatilityThresholdPct?: number;
}): SpeedupStageReason[] {
  const reasons: SpeedupStageReason[] = [];
  const netPct = Number(params.position.pnl.netPct);
  const maxUpPct = Number(params.position.pnl.maxUpPct);
  const takeProfitPercent = Number(params.takeProfitPercent);
  const hasTakeProfitPercent =
    Number.isFinite(takeProfitPercent) && takeProfitPercent >= 0;
  const positiveThresholdPct = normalizeSpeedupPercent(
    params.positivePnlThresholdPct,
    DEFAULT_SPEEDUP_POSITIVE_PNL_THRESHOLD_PCT,
  );
  const negativeThresholdPct = normalizeSpeedupPercent(
    params.negativePnlThresholdPct,
    DEFAULT_SPEEDUP_NEGATIVE_PNL_THRESHOLD_PCT,
  );
  const takeProfitOffsetPct = normalizeSpeedupPercent(
    params.takeProfitOffsetPct,
    DEFAULT_SPEEDUP_TAKE_PROFIT_OFFSET_PCT,
  );

  if (Number.isFinite(netPct) && netPct >= positiveThresholdPct) {
    reasons.push("POSITIVE_PNL_THRESHOLD");
  }
  if (Number.isFinite(netPct) && netPct <= -negativeThresholdPct) {
    reasons.push("NEGATIVE_PNL_THRESHOLD");
  }
  if (
    params.useStopLossPlus !== false &&
    hasTakeProfitPercent &&
    Number.isFinite(maxUpPct) &&
    maxUpPct >= takeProfitPercent
  ) {
    reasons.push("STOP_LOSS_PLUS_ARMED");
  }
  if (
    Number.isFinite(netPct) &&
    hasTakeProfitPercent &&
    netPct >= Math.max(0, takeProfitPercent - takeProfitOffsetPct)
  ) {
    reasons.push("NEAR_TAKE_PROFIT");
  }
  if (
    isApproachingPostAverageTarget({
      latestVolatilityPoint: params.latestVolatilityPoint,
      position: params.position,
      volatilityThresholdPct: params.volatilityThresholdPct,
    })
  ) {
    reasons.push("POST_AVERAGE_TARGET_APPROACH");
  }
  if (
    hasPositionHitTargetVolatilityPoint({
      position: params.position,
      volatilityPoints: params.volatilityPoints ?? [],
    })
  ) {
    reasons.push("TARGET_VPOINT_HIT");
  }

  return reasons;
}

/** Reclassifies a still-open position for its next monitoring pass. */
function updateMonitoringStage(
  context: RuntimeContext,
  position: Position,
): void {
  const accountConfig = context.helper.getAccountConfig(position.account);
  const volatilityPoints =
    context.state.vPointsMap[position.symbol.toUpperCase()] ?? [];
  const reasons = getSpeedupReasons({
    latestVolatilityPoint: volatilityPoints.at(-1),
    negativePnlThresholdPct:
      context.state.config.runtime.speedupStageNegativePnlThresholdPct,
    positivePnlThresholdPct:
      context.state.config.runtime.speedupStagePositivePnlThresholdPct,
    position,
    takeProfitOffsetPct:
      context.state.config.runtime.speedupStageTakeProfitOffsetPct,
    takeProfitPercent: accountConfig.takeProfitPercent,
    useStopLossPlus: accountConfig.useStopLossPlus,
    volatilityPoints,
  });
  const stage = reasons.length > 0 ? "speedup" : "standard";
  const reason =
    reasons.length > 0
      ? describeSpeedupReasons(reasons)
      : describeStandardReason({
          negativePnlThresholdPct:
            context.state.config.runtime.speedupStageNegativePnlThresholdPct,
          positivePnlThresholdPct:
            context.state.config.runtime.speedupStagePositivePnlThresholdPct,
          position,
        });

  position.lastMonitoringStage = {
    lastUpdated: context.state.currentTime,
    reason,
    stage,
  };
}

/** Finds the shared source point an entry signal was generated from. */
function findEntrySignalVolatilityPoint(params: {
  entrySignal: Pick<VolatilityPoint, "id">;
  volatilityPoints?: VolatilityPoint[];
}): VolatilityPoint | undefined {
  const entryId = String(params.entrySignal.id || "").trim();
  if (!entryId) {
    return undefined;
  }

  return (params.volatilityPoints ?? []).find(
    (point) => String(point.id || "").trim() === entryId,
  );
}

/** Marks an entry signal's source volatility point as used after entry succeeds. */
function markVPointUsed(params: {
  accountSlug: string;
  recommendation: EntryRecommendation | AveragingRecommendation;
  volatilityPoints?: VolatilityPoint[];
}): void {
  // BOTH:ENTRY_ONLY_IN_UNIQUE_VOLATILITY_POINT_ID
  const point = findEntrySignalVolatilityPoint({
    entrySignal: params.recommendation,
    volatilityPoints: params.volatilityPoints,
  });
  if (!point) {
    return;
  }

  const accountSlug = String(params.accountSlug || "").trim();
  if (accountSlug) {
    Object.assign(point, {
      [`usedBy${accountSlug}`]: true,
    });
    return;
  }

  // Keep the legacy point-wide marker for callers without account identity.
  point.used = true;
}

const positions = {
  updatePnl,
  updateMonitoringStage,
  markVPointUsed,
} as const;

export default positions;
