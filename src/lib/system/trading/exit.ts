import moment from "moment-timezone";

import type {
  RuntimeContext,
  RuntimeExitDecision,
} from "@/lib/precision/types";
import type {
  RuntimeAccountTradingConfig,
  RuntimeManagementConfig,
} from "../runtime";
import { systemLog } from "../logging";
import format from "../utils/format";
import pnl from "./pnl";
import type {
  LevelBasedPctDriftStopLossCondition,
  LevelBasedPctDriftStopLossConfig,
  Position,
  PositionCloseReason,
  PositionCloseSourceOverride,
  PositionVPointRef,
  PostAverageRescueExitConfig,
  PostAverageRescueExitThreshold,
  PostAverageStopLossConfig,
  PostAverageStopLossThreshold,
  TradeDecision,
} from "./types";
import type { VolatilityPoint } from "../types";
import { VOLATILITY_THRESHOLD } from "../constants";

const TRADE_MESSAGE = {
  hold: "[HOLD]",
  sell: {
    SELL: "[SELL]",
    FINAL: "[FINAL_SELL]",
    TP: "[TAKE_PROFIT]",
    POST_AVERAGE_RESCUE_EXIT: "[POST_AVERAGE_RESCUE_EXIT]",
    POST_AVERAGE_STOP_LOSS: "[POST_AVERAGE_STOP_LOSS]",
    SL: "[STOP_LOSS]",
    SL_PLUS: "[STOP_LOSS_PLUS_TP]",
  },
} as const;

const DEFAULT_POST_AVERAGE_RESCUE_THRESHOLDS: readonly PostAverageRescueExitThreshold[] =
  [
    { minAveragingCount: 1, minNetPnlPct: 0.5 },
    { minAveragingCount: 2, minNetPnlPct: 0 },
    { minAveragingCount: 3, minNetPnlPct: -0.5 },
  ];

const DEFAULT_POST_AVERAGE_STOP_LOSS_THRESHOLDS: readonly PostAverageStopLossThreshold[] =
  [{ maxNetPnlPct: 0, maxNetPnlUsdt: 0, minAveragingCount: 1 }];

export type ExitEvaluationConfig = RuntimeAccountTradingConfig &
  RuntimeManagementConfig;

/** Formats timestamps exactly like the legacy datasets time helper. */
function timeMsToReadable(
  time?: number,
  format: string = "DD_MMM_YYYY_HH_mm",
): string {
  return moment(time).format(format);
}

/** Counts completed averaging fills, with USED steps as legacy fallback. */
function countCompletedAveraging(
  position?: Pick<Position, "strategy"> | null,
): number {
  const averaging = position?.strategy.averaging;
  if (!averaging) {
    return 0;
  }

  const executionCount = Array.isArray(averaging.executions)
    ? averaging.executions.length
    : 0;
  const usedStepCount = Array.isArray(averaging.steps)
    ? averaging.steps.filter((step) => step.status === "USED").length
    : 0;

  return Math.max(executionCount, usedStepCount);
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

/** Resolves the minimum net PnL for the completed averaging count. */
function getPostAverageMinimumNetPnlPercent(
  completedAveragingCount: number,
  config?: PostAverageRescueExitConfig,
): number | undefined {
  const resolvedConfig = config ?? {
    enabled: true,
    thresholds: DEFAULT_POST_AVERAGE_RESCUE_THRESHOLDS,
  };
  if (!resolvedConfig.enabled) {
    return undefined;
  }

  let selected: PostAverageRescueExitThreshold | undefined;
  const thresholds = Array.isArray(resolvedConfig.thresholds)
    ? resolvedConfig.thresholds
    : [];
  for (const threshold of thresholds) {
    if (
      Number.isFinite(threshold.minAveragingCount) &&
      Number.isFinite(threshold.minNetPnlPct) &&
      threshold.minAveragingCount <= completedAveragingCount &&
      (!selected || threshold.minAveragingCount > selected.minAveragingCount)
    ) {
      selected = threshold;
    }
  }

  return selected?.minNetPnlPct;
}

/** Evaluates the tiered post-average rescue exit against current net PnL. */
function evaluatePostAverageRescue({
  currentPrice,
  direction,
  lastVolatilityPrice,
  netPnlPercent,
  position,
  config,
}: {
  currentPrice: number;
  direction?: Position["direction"];
  lastVolatilityPrice?: number;
  netPnlPercent: number;
  position?: Pick<Position, "strategy"> | null;
  config?: PostAverageRescueExitConfig;
}) {
  // BOTH:POST_AVERAGE_RESCUE_EXIT
  const completedAveragingCount = countCompletedAveraging(position);
  const minimumNetPnlPercent = getPostAverageMinimumNetPnlPercent(
    completedAveragingCount,
    config,
  );
  const favorableDistancePercent = calculateFavorableDistancePercent({
    currentPrice,
    direction,
    lastVolatilityPrice,
  });
  const hasRequiredNetPnl =
    minimumNetPnlPercent !== undefined && netPnlPercent >= minimumNetPnlPercent;

  return {
    completedAveragingCount,
    favorableDistancePercent,
    minimumNetPnlPercent,
    shouldExit:
      favorableDistancePercent >= VOLATILITY_THRESHOLD && hasRequiredNetPnl,
  };
}

function normalizePostAverageLossBoundary(value: unknown): number {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.min(0, numericValue) : 0;
}

/** Sanitizes persisted or user-edited post-average stop loss configuration. */
function normalizePostAverageStopLossConfig(
  config?: PostAverageStopLossConfig,
): PostAverageStopLossConfig {
  if (!config) {
    return {
      enabled: false,
      thresholds: DEFAULT_POST_AVERAGE_STOP_LOSS_THRESHOLDS.map(
        (threshold) => ({ ...threshold }),
      ),
    };
  }

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
      maxNetPnlPct: normalizePostAverageLossBoundary(threshold.maxNetPnlPct),
      maxNetPnlUsdt: normalizePostAverageLossBoundary(threshold.maxNetPnlUsdt),
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
function getPostAverageStopLossThreshold(
  completedAveragingCount: number,
  config?: PostAverageStopLossConfig,
): PostAverageStopLossThreshold | undefined {
  const resolvedConfig = normalizePostAverageStopLossConfig(config);
  if (!resolvedConfig.enabled) return undefined;

  let selected: PostAverageStopLossThreshold | undefined;
  for (const threshold of resolvedConfig.thresholds) {
    if (threshold.minAveragingCount <= completedAveragingCount) {
      selected = threshold;
    }
  }
  return selected;
}

/** Evaluates independent fee-aware percent and USDT loss boundaries. */
function evaluatePostAverageStopLoss({
  config,
  netPnlPercent,
  netPnlUsdt,
  position,
}: {
  config?: PostAverageStopLossConfig;
  netPnlPercent: number;
  netPnlUsdt: number;
  position?: Pick<Position, "strategy"> | null;
}) {
  const completedAveragingCount = countCompletedAveraging(position);
  const threshold = getPostAverageStopLossThreshold(
    completedAveragingCount,
    config,
  );
  const percentEnabled = (threshold?.maxNetPnlPct ?? 0) < 0;
  const usdtEnabled = (threshold?.maxNetPnlUsdt ?? 0) < 0;
  const hitPercent =
    percentEnabled && netPnlPercent <= (threshold?.maxNetPnlPct ?? 0);
  const hitUsdt = usdtEnabled && netPnlUsdt <= (threshold?.maxNetPnlUsdt ?? 0);

  return {
    completedAveragingCount,
    hitPercent,
    hitUsdt,
    shouldExit: hitPercent || hitUsdt,
    threshold,
  };
}

/** Sanitizes persisted or user-edited exact-level drift conditions. */
function normalizeLevelBasedDriftConfig(
  config?: LevelBasedPctDriftStopLossConfig,
  defaultAdverseDriftPct = VOLATILITY_THRESHOLD,
): LevelBasedPctDriftStopLossConfig {
  if (!config) return { enabled: false, conditions: [] };

  const conditions = new Map<number, LevelBasedPctDriftStopLossCondition>();
  for (const condition of Array.isArray(config.conditions)
    ? config.conditions
    : []) {
    const absoluteLevel = Math.floor(Math.abs(Number(condition.absoluteLevel)));
    if (!Number.isFinite(absoluteLevel) || absoluteLevel < 1) continue;

    const configuredPct = Number(condition.adverseDriftPct);
    conditions.set(absoluteLevel, {
      absoluteLevel,
      adverseDriftPct:
        Number.isFinite(configuredPct) && configuredPct > 0
          ? configuredPct
          : defaultAdverseDriftPct,
    });
  }

  return {
    enabled: config.enabled === true,
    conditions: [...conditions.values()].sort(
      (left, right) => left.absoluteLevel - right.absoluteLevel,
    ),
  };
}

/** Selects only a condition whose level exactly matches the current vPoint. */
function getLevelBasedDriftCondition(
  absoluteLevel: number,
  config?: LevelBasedPctDriftStopLossConfig,
) {
  const normalized = normalizeLevelBasedDriftConfig(config);
  if (!normalized.enabled) return undefined;
  return normalized.conditions.find(
    (condition) => condition.absoluteLevel === Math.abs(absoluteLevel),
  );
}

/** Resolves the adverse trigger price from the selected vPoint anchor. */
function resolveLevelBasedDriftTriggerPrice(
  anchorPrice: number,
  adverseDriftPct: number,
  direction: Position["direction"],
) {
  const multiplier = adverseDriftPct / 100;
  return direction === "SHORT"
    ? anchorPrice * (1 + multiplier)
    : anchorPrice * (1 - multiplier);
}

/** Evaluates the exact-level adverse drift stop against the current price. */
function evaluateLevelBasedDrift({
  config,
  currentPrice,
  direction,
  vPoint,
}: {
  config?: LevelBasedPctDriftStopLossConfig;
  currentPrice: number;
  direction: Position["direction"];
  vPoint?: { lvl: number; p: number } | null;
}) {
  const condition = vPoint
    ? getLevelBasedDriftCondition(vPoint.lvl, config)
    : undefined;
  const triggerPrice =
    condition && vPoint
      ? resolveLevelBasedDriftTriggerPrice(
          vPoint.p,
          condition.adverseDriftPct,
          direction,
        )
      : null;
  const adverseDriftPct =
    vPoint && vPoint.p > 0
      ? direction === "SHORT"
        ? ((currentPrice - vPoint.p) / vPoint.p) * 100
        : ((vPoint.p - currentPrice) / vPoint.p) * 100
      : 0;

  // BOTH:LEVEL_BASED_PCT_DRIFT_STOP_LOSS
  return {
    adverseDriftPct,
    condition,
    shouldExit:
      Boolean(condition) &&
      Number.isFinite(currentPrice) &&
      adverseDriftPct >= (condition?.adverseDriftPct ?? Infinity),
    triggerPrice,
  };
}

/** Checks the tighter stop loss enabled after an opposite volatility target hit. */
function shouldExitVolatilityTargetStopLoss({
  feeAdjustedNetProfitPercent,
  hasHitTargetZone,
  stopLossPercent,
}: {
  feeAdjustedNetProfitPercent: number;
  hasHitTargetZone: boolean;
  stopLossPercent?: number;
}) {
  return (
    hasHitTargetZone &&
    Number.isFinite(stopLossPercent) &&
    stopLossPercent !== undefined &&
    stopLossPercent > 0 &&
    feeAdjustedNetProfitPercent <= -stopLossPercent
  );
}

/**
 * Crops and compacts the ordered vPoints strictly between entry and exit.
 */
function getIntermediateVPoints(params: {
  position: Pick<Position, "closed" | "opened">;
  volatilityPoints: Array<PositionVPointRef & { t: number }>;
}): PositionVPointRef[] | undefined {
  // BOTH:POSITION_VPOINT_PATH
  const { position } = params;
  if (!position.closed) return undefined;
  const closed = position.closed;

  const seenIds = new Set<string>();
  const sortedPoints = [...params.volatilityPoints]
    .filter(
      (point) =>
        typeof point.id === "string" &&
        point.id.trim().length > 0 &&
        Number.isFinite(point.t) &&
        Number.isFinite(point.lvl),
    )
    .sort((left, right) => left.t - right.t)
    .filter((point) => {
      if (seenIds.has(point.id)) return false;
      seenIds.add(point.id);
      return true;
    });
  const entryIndex = sortedPoints.findIndex(
    (point) => point.id === position.opened.vPoint.id,
  );
  if (entryIndex < 0) return undefined;

  const exitId = closed.vPoint?.id;
  const exitIndex = exitId
    ? sortedPoints.findIndex(
        (point, index) => index > entryIndex && point.id === exitId,
      )
    : -1;
  const endIndex =
    exitIndex >= 0
      ? exitIndex
      : sortedPoints.findIndex(
          (point, index) => index > entryIndex && point.t > closed.t,
        );
  const boundedPoints = sortedPoints.slice(
    entryIndex + 1,
    endIndex >= 0 ? endIndex : undefined,
  );

  return boundedPoints
    .filter(
      (point) =>
        point.id !== position.opened.vPoint.id && point.id !== exitId,
    )
    .map(({ id, lvl }) => ({ id, lvl }));
}

/**
 * Closes the cloned position exactly like the legacy exit mutation: fee-aware
 * metrics, close event, intermediate vPoint path, and estimated-exit cleanup.
 */
function closePosition(
  position: Position,
  params: {
    exitPrice: number;
    t: number;
    reason?: PositionCloseReason;
    message?: string;
    source?: PositionCloseSourceOverride;
    roundTripFeeRatio?: number;
    lastVolatilityPoint?: VolatilityPoint;
    volatilityPoints: VolatilityPoint[];
  },
): void {
  const metrics = pnl.computeClosedMetrics(
    position,
    params.exitPrice,
    params.roundTripFeeRatio,
  );
  if (!metrics) {
    return;
  }

  position.pnl.netPct = metrics.netProfitPercent;
  position.pnl.currentValueUsdt = metrics.netCurrentUSDT;
  position.pnl.netUsdt = metrics.netProfitUSDT;
  // BOTH:POSITION_PNL_USDT_EXTREMA
  pnl.applyNetUsdtExtrema(position, metrics.netProfitUSDT);

  const totalFeeUsdt =
    position.exposure.notionalUsdt * (params.roundTripFeeRatio ?? 0);
  position.closed = {
    t: params.t,
    source: params.source,
    price: params.exitPrice,
    feeUsdt: Math.max(0, totalFeeUsdt - position.fees.entryUsdt),
    vPoint: params.lastVolatilityPoint
      ? { id: params.lastVolatilityPoint.id, lvl: params.lastVolatilityPoint.lvl }
      : undefined,
    reason: params.reason ?? "UNKNOWN",
    message: params.message ?? params.reason ?? "UNKNOWN",
  };

  const intermediateVPoints = getIntermediateVPoints({
    position,
    volatilityPoints: params.volatilityPoints,
  });
  if (intermediateVPoints) {
    position.vPoints = intermediateVPoints;
  }
  delete position.fees.estimatedExitUsdt;
}

/** Evaluates the exact legacy exit rule order against one cloned position. */
function evaluateExit(params: {
  position: Position;
  symbol: string;
  price: number;
  timeMs: number;
  volatilityPoints: VolatilityPoint[];
  config: ExitEvaluationConfig;
  roundTripFeeRatio: number;
}): TradeDecision {
  const {
    position,
    symbol,
    price,
    timeMs,
    volatilityPoints,
    config,
    roundTripFeeRatio,
  } = params;
  const readableTime = timeMsToReadable(timeMs);

  // Mirrors legacy sellPosition: the last volatility point is always attached
  // to the close event, and the caller's reason becomes closed.message.
  const sellClone = (sellParams: {
    closeReason?: PositionCloseReason;
    exitMessage?: string;
    closeSource?: PositionCloseSourceOverride;
  }): Position => {
    closePosition(position, {
      exitPrice: price,
      t: timeMs,
      reason: sellParams.closeReason,
      message: sellParams.exitMessage,
      source: sellParams.closeSource,
      roundTripFeeRatio,
      lastVolatilityPoint: volatilityPoints.at(-1),
      volatilityPoints,
    });
    return position;
  };

  // B.2 Force sell positions flagged with control.forceExit.
  if (position.control?.forceExit) {
    const totalQuantity = position.exposure.quantity ?? 0;
    const avgEntry = position.exposure.averageEntryPrice;
    const isShort = position.direction === "SHORT";
    const grossGain = isShort
      ? (avgEntry - price) / avgEntry
      : (price - avgEntry) / avgEntry;
    const netGain = grossGain - roundTripFeeRatio;

    const reason = `[SELL] ${readableTime} ${
      TRADE_MESSAGE.sell.FINAL
    } FINAL SELL hit at ${(netGain * 100).toFixed(2)}% | Category ${
      position?.strategy.entry.label
    } | Reason ${position.control.forceExit.reason}`;

    const lastPosition = sellClone({
      exitMessage: reason,
      closeReason: "FORCED",
    });

    delete lastPosition.control!.forceExit;
    if (Object.keys(lastPosition.control!).length === 0) {
      delete lastPosition.control;
    }

    return {
      action: "SELL",
      price,
      amount: totalQuantity,
      category: TRADE_MESSAGE.sell.FINAL,
      reason,
      profit: netGain,
      position: lastPosition,
      emailNotif: `[SELL] FINAL SELL`,
    };
  }

  // C. EXIT LOGIC (Stop Loss / Trailing Stop)
  const totalQuantity = position.exposure.quantity ?? 0;
  const totalUSDT = position.exposure.notionalUsdt ?? 0;

  const avgEntry = position.exposure.averageEntryPrice ?? 0;

  const isShort = position.direction === "SHORT";
  const grossGain = isShort
    ? (avgEntry - price) / avgEntry
    : (price - avgEntry) / avgEntry;
  const netGain = grossGain - roundTripFeeRatio;
  const netCurrentUSDT = totalUSDT * (1 + netGain);
  const netProfitUSDT = netCurrentUSDT - totalUSDT;
  const lastVolatility = volatilityPoints.at(-1);
  const lastVPrice = lastVolatility?.p ?? 0;
  const direction = position.direction || "LONG";
  const targetZoneLabel = direction === "LONG" ? "T" : "B";
  const entryTime = position.opened.t ?? 0;
  const hasHitTargetZone = volatilityPoints.some(
    (point) => point.l === targetZoneLabel && point.t >= entryTime,
  );

  // C.1 Exit at configured absolute vPoint level
  // PROD:EXIT_ON_VPOINT_LEVEL
  const configuredExitOnVPointAbsLevel = Math.max(
    0,
    Math.floor(Number(config.exitOnVPointAbsLevel) || 0),
  );
  const latestAbsVPointLevel = Number.isFinite(Number(lastVolatility?.lvl))
    ? Math.abs(Number(lastVolatility?.lvl))
    : null;

  if (
    configuredExitOnVPointAbsLevel > 0 &&
    latestAbsVPointLevel !== null &&
    latestAbsVPointLevel >= configuredExitOnVPointAbsLevel
  ) {
    const reason = `[SELL] ${readableTime} ${
      TRADE_MESSAGE.sell.SL
    } PROD:EXIT_ON_VPOINT_LEVEL latest absolute vPoint level ${latestAbsVPointLevel} reached configured level ${configuredExitOnVPointAbsLevel} | Net PnL ${(netGain * 100).toFixed(2)}%`;

    const lastPosition = sellClone({
      exitMessage: reason,
      closeReason: "EXIT_ON_VPOINT_LEVEL",
    });

    return {
      action: "SELL",
      price,
      amount: totalQuantity,
      category: TRADE_MESSAGE.sell.SL,
      reason,
      profit: netGain,
      position: lastPosition,
      emailNotif: `😞 [SELL] vPoint level exit triggered`,
    };
  }

  const levelBasedDriftStop = evaluateLevelBasedDrift({
    config: config.levelBasedPctDriftStopLoss,
    currentPrice: price,
    direction,
    vPoint: lastVolatility,
  });

  // BOTH:LEVEL_BASED_PCT_DRIFT_STOP_LOSS
  if (levelBasedDriftStop.shouldExit && levelBasedDriftStop.condition) {
    const { absoluteLevel, adverseDriftPct } = levelBasedDriftStop.condition;
    const reason = `[SELL] ${readableTime} ${
      TRADE_MESSAGE.sell.SL
    } BOTH:LEVEL_BASED_PCT_DRIFT_STOP_LOSS absolute vPoint level ${absoluteLevel} adverse drift ${levelBasedDriftStop.adverseDriftPct.toFixed(
      2,
    )}% reached ${adverseDriftPct}% | anchor ${lastVPrice} | trigger ${levelBasedDriftStop.triggerPrice}`;

    const lastPosition = sellClone({
      exitMessage: reason,
      closeReason: "LEVEL_BASED_PCT_DRIFT_STOP_LOSS",
    });

    return {
      action: "SELL",
      price,
      amount: totalQuantity,
      category: TRADE_MESSAGE.sell.SL,
      reason,
      profit: netGain,
      position: lastPosition,
      emailNotif: `😞 [SELL] level-based vPoint drift stop triggered`,
    };
  }

  // C.2 Stop loss by fee-adjusted net USDT loss
  // PROD:STOP_LOSS_BY_USDT_LOSS
  const configuredStopLossUSDT = Number(config.stopLossUSDT ?? 50);
  const stopLossUSDT =
    Number.isFinite(configuredStopLossUSDT) && configuredStopLossUSDT > 0
      ? configuredStopLossUSDT
      : 0;

  if (stopLossUSDT > 0 && netProfitUSDT <= -stopLossUSDT) {
    const reason = `[SELL] ${readableTime} ${
      TRADE_MESSAGE.sell.SL
    } PROD:STOP_LOSS_BY_USDT_LOSS net USDT PnL ${netProfitUSDT.toFixed(
      2,
    )} reached -${stopLossUSDT.toFixed(2)} USDT`;

    const lastPosition = sellClone({
      exitMessage: reason,
      closeReason: "STOP_LOSS_BY_USDT_LOSS",
    });

    return {
      action: "SELL",
      price,
      amount: totalQuantity,
      category: TRADE_MESSAGE.sell.SL,
      reason,
      profit: netGain,
      position: lastPosition,
      emailNotif: `😞 [SELL] USDT stop loss triggered`,
    };
  }

  // C.3 Hard stop loss (only if defined)
  // BOTH:TRADITIONAL_TP_SL
  if (config.stopLossPercent) {
    if (netGain <= -config.stopLossPercent / 100) {
      const reason = `[SELL] ${readableTime} ${
        TRADE_MESSAGE.sell.SL
      } Stop loss hit at ${(netGain * 100).toFixed(2)}%`;

      const lastPosition = sellClone({
        exitMessage: reason,
        closeReason: "STOP_LOSS",
      });

      return {
        action: "SELL",
        price,
        amount: totalQuantity,
        category: TRADE_MESSAGE.sell.SL,
        reason,
        profit: netGain,
        position: lastPosition,
        emailNotif: `😞 [SELL] Stop loss triggered`,
      };
    }
  }

  // BOTH:VOLATILITY_TARGET_SL_VALUE
  if (
    shouldExitVolatilityTargetStopLoss({
      feeAdjustedNetProfitPercent: netGain * 100,
      hasHitTargetZone,
      stopLossPercent: config.volatilityTargetStopLossPercent,
    })
  ) {
    const reason = `[SELL] ${readableTime} ${
      TRADE_MESSAGE.sell.SL
    } BOTH:VOLATILITY_TARGET_SL_VALUE at ${(netGain * 100).toFixed(
      2,
    )}% after ${targetZoneLabel} target zone | Price ${price}`;

    const lastPosition = sellClone({
      exitMessage: reason,
      closeReason: "VOLATILITY_TARGET_SL",
    });

    return {
      action: "SELL",
      price,
      amount: totalQuantity,
      category: TRADE_MESSAGE.sell.SL,
      reason,
      profit: netGain,
      position: lastPosition,
      emailNotif: `😞 [SELL] Volatility target stop loss triggered`,
    };
  }

  const pctVPointPriceAndCurrentPrice = calculateFavorableDistancePercent({
    currentPrice: price,
    direction: position.direction,
    lastVolatilityPrice: lastVPrice,
  });

  const postAverageLoss = evaluatePostAverageStopLoss({
    config: config.postAverageStopLoss,
    netPnlPercent: netGain * 100,
    netPnlUsdt: netProfitUSDT,
    position,
  });

  // BOTH:POST_AVERAGE_STOP_LOSS
  if (postAverageLoss.shouldExit) {
    const threshold = postAverageLoss.threshold!;
    const reason =
      `[SELL] ${readableTime} ${
        TRADE_MESSAGE.sell.POST_AVERAGE_STOP_LOSS
      } BOTH:POST_AVERAGE_STOP_LOSS after ${
        postAverageLoss.completedAveragingCount
      } averaging execution(s)` +
      ` | Net PnL ${(netGain * 100).toFixed(2)}% / ${netProfitUSDT.toFixed(2)} USDT` +
      ` | Threshold ${threshold.maxNetPnlPct}% / ${threshold.maxNetPnlUsdt} USDT` +
      ` | Trigger ${postAverageLoss.hitPercent ? "pct" : ""}${
        postAverageLoss.hitPercent && postAverageLoss.hitUsdt ? "+" : ""
      }${postAverageLoss.hitUsdt ? "usdt" : ""}`;

    const lastPosition = sellClone({
      closeReason: "POST_AVERAGE_STOP_LOSS",
      exitMessage: reason,
    });

    return {
      action: "SELL",
      amount: totalQuantity,
      category: TRADE_MESSAGE.sell.POST_AVERAGE_STOP_LOSS,
      emailNotif: `😞 [SELL] Post-average stop loss triggered`,
      position: lastPosition,
      price,
      profit: netGain,
      reason,
    };
  }

  const rescueExit = evaluatePostAverageRescue({
    netPnlPercent: netGain * 100,
    currentPrice: price,
    direction: position.direction,
    lastVolatilityPrice: lastVPrice,
    position,
    config: config.postAverageRescueExit,
  });

  // BOTH:POST_AVERAGE_RESCUE_EXIT
  if (rescueExit.shouldExit) {
    const reason =
      `[SELL] ${readableTime} ${
        TRADE_MESSAGE.sell.POST_AVERAGE_RESCUE_EXIT
      } Post-average rescue exit at ${(netGain * 100).toFixed(
        2,
      )}% net PnL after ${rescueExit.completedAveragingCount} averaging execution(s)` +
      ` | Required net PnL ${rescueExit.minimumNetPnlPercent}%` +
      ` | Distance from last V point ${pctVPointPriceAndCurrentPrice.toFixed(
        2,
      )}% | Price ${price} | SELL (entry ${totalUSDT.toFixed(
        2,
      )} | now ${netCurrentUSDT.toFixed(2)} | Profit ${netProfitUSDT.toFixed(
        2,
      )}) | Category: ${position?.strategy.entry.label} | Volatility Level: ${
        lastVolatility?.lvl
      } ${lastVolatility?.l}`;

    const lastPosition = sellClone({
      exitMessage: reason,
      closeReason: "POST_AVERAGE_RESCUE_EXIT",
    });

    return {
      action: "SELL",
      price,
      amount: totalQuantity,
      category: TRADE_MESSAGE.sell.POST_AVERAGE_RESCUE_EXIT,
      reason,
      profit: netGain,
      position: lastPosition,
      emailNotif: `🔒 [SELL] Post-average rescue exit`,
    };
  }

  // C.2 STOP LOSS PLUS
  // PROD:SL_PLUS
  const useSLPlus =
    config.useStopLossPlus === undefined ? true : config.useStopLossPlus;

  if (useSLPlus) {
    const stopLossPlusTrigger = (config.stopLossPlusTrigger ?? 1) / 100;
    const memKey = `${symbol}-peakGain`;

    // Precision replays evaluate a cloned memory, so peak state is local to
    // this evaluation and never persists across cycles — identical to the
    // legacy bridge, which discarded the cloned model memory every call.
    const memory: Record<string, number | undefined> = {};

    // Track peak gain once take profit threshold hit
    if (netGain >= config.takeProfitPercent / 100) {
      if (memory[memKey] == undefined) {
        memory[memKey] = netGain;
      }
    }

    // Update peak gain memory
    if (memory[memKey] !== undefined) {
      const peakGain: number = memory[memKey] ?? netGain;
      if (netGain > peakGain) {
        memory[memKey] = netGain;
      }

      // If price retraces from peak by stopLossPlusTrigger → SELL
      const drawdown = netGain - peakGain;
      if (drawdown <= -stopLossPlusTrigger) {
        delete memory[memKey]; // reset memory

        const reason = `[SELL] ${readableTime} - ${
          TRADE_MESSAGE.sell.SL_PLUS
        } Locked profit at ${(netGain * 100).toFixed(
          2,
        )}% | Price ${price} | SELL (entry ${totalUSDT.toFixed(
          2,
        )} | now ${netCurrentUSDT.toFixed(2)} | Profit ${netProfitUSDT.toFixed(
          2,
        )}) | Category: ${position?.strategy.entry.label}`;

        const lastPosition = sellClone({
          exitMessage: reason,
          closeReason: "STOP_LOSS_PLUS_TP",
        });

        return {
          action: "SELL",
          price,
          amount: totalQuantity,
          category: TRADE_MESSAGE.sell.SL_PLUS,
          reason,
          profit: netGain,
          position: lastPosition,
          emailNotif: `🔒 [SELL] Stop Loss+ secured profit`,
        };
      }
    }
  }

  const currentPrice = price;

  const grossGainTarget = isShort
    ? (avgEntry - currentPrice) / avgEntry
    : (currentPrice - avgEntry) / avgEntry;

  const actualGain = grossGainTarget - roundTripFeeRatio;
  const actualCurrentUSDT = totalUSDT * (1 + actualGain);
  const actualProfitUSDT = actualCurrentUSDT - totalUSDT;

  // BOTH:VOLATILITY_TARGET_TP
  // C.3  TP when already hit volatility target zone.
  if (hasHitTargetZone && actualGain > 0) {
    // TP at current price
    const reason = `[SELL] ${readableTime} ${
      TRADE_MESSAGE.sell.TP
    } Volatility target zone hit at ${(actualGain * 100).toFixed(
      2,
    )}% | Its already ${targetZoneLabel} | Price ${price} | SELL (entry ${totalUSDT.toFixed(
      2,
    )} | now ${actualCurrentUSDT.toFixed(2)} | Profit ${actualProfitUSDT.toFixed(
      2,
    )}) | Category: ${position?.strategy.entry.label} | Volatility Level: ${
      lastVolatility?.lvl
    } | V Gain ${lastVolatility?.pct.toFixed(2)}% 
      `;

    const lastPosition = sellClone({
      exitMessage: reason,
      closeReason: "VOLATILITY_TARGET_TP",
    });

    return {
      action: "SELL",
      price,
      amount: totalQuantity,
      category: TRADE_MESSAGE.sell.TP,
      reason,
      profit: actualGain,
      position: lastPosition,
      emailNotif: `🔒 [SELL] TP secured profit (volatility target hit)`,
    };
  }

  if (!useSLPlus) {
    // C.4 TRADITIONAL TAKE PROFIT
    // BOTH:TRADITIONAL_TP_SL
    if (actualGain >= config.takeProfitPercent / 100 && hasHitTargetZone) {
      const reason = `${TRADE_MESSAGE.sell.SELL} ${readableTime} - ${
        TRADE_MESSAGE.sell.TP
      } Locked profit at ${(actualGain * 100).toFixed(
        2,
      )}% | Price ${price} | SELL (entry ${totalUSDT.toFixed(
        2,
      )} | now ${actualCurrentUSDT.toFixed(2)} | Profit ${actualProfitUSDT.toFixed(
        2,
      )}) | Category: ${position?.strategy.entry.label} | Volatility Level: ${
        lastVolatility?.lvl
      } | V Gain ${lastVolatility?.pct.toFixed(2)}% 
      `;

      const lastPosition = sellClone({
        exitMessage: reason,
        closeReason: "TAKE_PROFIT",
      });

      return {
        action: "SELL",
        price,
        amount: totalQuantity,
        category: TRADE_MESSAGE.sell.TP,
        reason,
        profit: netGain,
        position: lastPosition,
        emailNotif: `🔒 [SELL] TP secured profit`,
      };
    } else {
      let reason = `${TRADE_MESSAGE.hold} ${symbol} - `;

      const netGainVolatility =
        (lastVPrice - avgEntry) / avgEntry - roundTripFeeRatio;

      reason += `currentPrice(used): ${currentPrice.toFixed(
        2,
      )} | current price kline: ${price.toFixed(
        2,
      )} | Avg Entry Last Position: ${avgEntry.toFixed(
        2,
      )} | Net gain (using kline price): ${(netGain * 100).toFixed(
        2,
      )}% | Net gain (using volatility price): ${(
        netGainVolatility * 100
      ).toFixed(2)}% | Actual Gain: ${(actualGain * 100).toFixed(
        2,
      )}% | takeProfitPercent: ${config.takeProfitPercent.toFixed(2)}% | 

        Gross gain target: ${(grossGainTarget * 100).toFixed(2)}%
        Fees: ${(roundTripFeeRatio * 100).toFixed(2)}%

        | Last Volatility Price: ${lastVPrice.toFixed(2)} Level: ${
          lastVolatility?.lvl
        } ${lastVolatility?.l}
        `;

      return {
        action: "HOLD",
        reason,
      };
    }
  }

  // D. DEFAULT → HOLD
  if (avgEntry) {
    const reason = `${
      TRADE_MESSAGE.hold
    } ${symbol} - Avg Entry Last Position: ${avgEntry.toFixed(
      2,
    )} | Net gain: ${(netGain * 100).toFixed(2)}%`;

    return {
      action: "HOLD",
      reason,
    };
  }

  return {
    action: "HOLD",
    reason: `${TRADE_MESSAGE.hold} ${symbol} - No signal`,
  };
}

function getEffectiveConfig(
  context: RuntimeContext,
  accountSlug: string,
): ExitEvaluationConfig {
  return {
    ...context.state.config.management,
    ...context.helper.getAccountConfig(accountSlug),
  };
}

async function findDecision(
  context: RuntimeContext,
  position: Position,
): Promise<RuntimeExitDecision | null> {
  const symbol = position.symbol.toUpperCase();
  const mark = context.state.markPriceMap[symbol];
  if (!mark) {
    throw new Error(`Runtime mark price not found for ${symbol}.`);
  }

  const clonedPosition = structuredClone(position);
  const volatilityPoints = structuredClone(
    context.state.vPointsMap[symbol] ?? [],
  );
  const config = getEffectiveConfig(context, position.account);
  const roundTripFeeRatio = context.adapter.exchange.getRoundTripFeeRate({
    type: config.orderType ?? "taker",
  });

  const tradeDecision = evaluateExit({
    position: clonedPosition,
    symbol,
    price: mark.price,
    timeMs: context.state.currentTime,
    volatilityPoints,
    config,
    roundTripFeeRatio,
  });

  if (tradeDecision.action !== "SELL") {
    return null;
  }

  return {
    accountSlug: position.account,
    message: tradeDecision.reason ?? tradeDecision.log ?? "Exit approved",
    position,
    symbol,
    tradeDecision,
    type: "exit",
  };
}

function execute(
  context: RuntimeContext,
  decision: RuntimeExitDecision,
): Position | null {
  const closedPosition = decision.tradeDecision.position;
  if (!closedPosition?.closed) {
    return null;
  }

  const position = structuredClone(closedPosition);
  const closed = position.closed;
  if (!closed) {
    return null;
  }

  if (context.state.mode === "backtest") {
    const netUsdt = position.pnl.netUsdt ?? 0;
    const netPct = position.pnl.netPct ?? 0;
    const signedUsdt = `${netUsdt >= 0 ? "+" : ""}${netUsdt.toFixed(2)}`;
    const signedPct = `${netPct >= 0 ? "+" : ""}${netPct.toFixed(2)}`;
    systemLog.info(
      `EXIT  ${position.symbol} ${position.direction} ` +
        `${format.timeForLog(closed.t)} | ` +
        `$${signedUsdt} (${signedPct}%) | ` +
        `${closed.reason}`,
    );
  }

  return position;
}

const exit = {
  evaluate: evaluateExit,
  findDecision,
  execute,
} as const;

export default exit;
