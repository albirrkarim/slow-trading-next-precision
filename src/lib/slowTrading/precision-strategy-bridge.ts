/**
 * Temporary migration bridge from the clean Precision `RuntimeStrategy` port to
 * the legacy SLOW/dynamic/brain/trading implementations. This file lives in the
 * legacy quarry on purpose: it is the only module besides the production/dev
 * adapter boundaries that may wire legacy behavior behind the clean contract.
 * The next slice replaces this bridge with the clean dissolved modules
 * (`system/trading` + `system/utils` + `precision/utils`); Precision
 * itself must never import it.
 */
import brain from "@/lib/brain";
import {
  createPredictorMemory,
  predictor,
  type DynamicTradeConfig,
  type PredictorMemory,
  type PredictionEngineMemory,
} from "@/lib/dynamic";
import { TradingMode } from "@/lib/exchange";
import slowTrading from "@/lib/slowTrading";
import slowTradingShared from "@/lib/slowTrading/shared";
import slowTradingWatchReserve from "@/lib/slowTrading/watch-reserve";
import tradingAveraging from "@/lib/system/trading/averaging";
import tradingEntry from "@/lib/system/trading/entry";
import entryAction from "@/lib/system/trading/entry-action";
import tradingExit from "@/lib/system/trading/exit";
import systemPositions from "@/lib/precision/utils/positions";
import systemVpoints from "@/lib/system/utils/vpoints";
import type { Kline, VolatilityPoint } from "@/lib/system/types";
import trading from "@/lib/trading";
import type {
  Position as TradingPosition,
  TradingModelMemory,
} from "@/lib/trading/models";
import type {
  RuntimeAveragingDecision,
  RuntimeContext,
  RuntimeEntryDecision,
  RuntimeExitDecision,
  RuntimeVPointMemory,
} from "@/lib/precision/types";
import type {
  AveragingRecommendation,
  EntryRecommendation,
  Position,
} from "@/lib/system/trading";
import type { RuntimeConfig } from "@/lib/system/runtime";

/** Builds an account-scoped copy for the production decision engine. */
function createAccountVolatilityMap(
  context: RuntimeContext,
  accountSlug: string,
) {
  return Object.fromEntries(
    Object.entries(context.state.vPointsMap).map(([symbol, points]) => [
      symbol,
      points.map((point) => ({
        ...point,
        used: slowTradingWatchReserve.volatilityPoint.isUsed({
          accountSlug,
          entrySignal: point,
          volatilityPoints: points,
        }),
      })),
    ]),
  );
}

/** Finds entry decisions with the same recommendation engine used in production. */
async function findEntries(
  context: RuntimeContext,
): Promise<RuntimeEntryDecision[]> {
  const decisions: RuntimeEntryDecision[] = [];
  const { config, openPositions, vPointsMap } = context.state;

  for (const account of config.accounts) {
    if (!account.enabled || !context.state.balance[account.slug]) continue;

    const accountPositions = openPositions.filter(
      (position) => position.account === account.slug && !position.closed,
    );
    const maxOpenPositions = Math.max(
      0,
      Math.floor(Number(account.trading.maxOpenPositions) || 0),
    );
    if (
      maxOpenPositions > 0 &&
      accountPositions.length >= maxOpenPositions
    ) {
      continue;
    }

    const evaluation = await brain.algorithms.recommendations.evaluate({
      decisionEngineVersion: config.management.decisionEngineVersion,
      minActionableAbsoluteLevel:
        account.trading.minActionableAbsoluteLevel,
      volatilityPointsMap: createAccountVolatilityMap(context, account.slug),
    });

    for (const entrySignal of evaluation.recommendations) {
      const symbol = String(entrySignal.symbol || "")
        .trim()
        .toUpperCase();
      if (!symbol) continue;
      if (
        config.management.tradingMode === TradingMode.SPOT &&
        entrySignal.l !== "B"
      ) {
        continue;
      }
      if (
        accountPositions.some(
          (position) => position.symbol.toUpperCase() === symbol,
        )
      ) {
        continue;
      }
      if (
        slowTradingWatchReserve.volatilityPoint.isUsed({
          accountSlug: account.slug,
          entrySignal,
          volatilityPoints: vPointsMap[symbol],
        })
      ) {
        continue;
      }

      decisions.push({
        accountSlug: account.slug,
        direction: entrySignal.l === "B" ? "LONG" : "SHORT",
        entrySignal,
        message: entrySignal.message,
        symbol,
        type: "entry",
      });
    }
  }

  return decisions;
}

/** Finds the existing production watch recommendation for one open position. */
async function findAveraging(
  context: RuntimeContext,
  position: Position,
): Promise<RuntimeAveragingDecision | null> {
  const accountConfig = context.helper.getAccountConfig(position.account);
  const balance = context.helper.getAccountBalance(position.account);
  const config: DynamicTradeConfig = {
    ...context.state.config.management,
    ...accountConfig,
  } as DynamicTradeConfig;
  const result = slowTradingWatchReserve.averaging.generateRecommendations({
    activePositions: [position as TradingPosition],
    config,
    quoteAsset: balance.available,
    reservedQuoteAsset: balance.reserved,
    volatilityPointsMap: context.state.vPointsMap,
  });
  const recommendation = result.recommendations.find(
    (candidate: AveragingRecommendation) =>
      String(candidate.symbol || "").toUpperCase() ===
      position.symbol.toUpperCase(),
  );
  if (!recommendation) return null;

  return {
    accountSlug: position.account,
    message: recommendation.message,
    position,
    recommendation,
    symbol: position.symbol.toUpperCase(),
    type: "averaging",
  };
}

/** Creates the current synthetic candle consumed by the production exit model. */
function createCurrentKline(context: RuntimeContext, symbol: string): Kline {
  const markPrice = context.state.markPriceMap[symbol];
  if (!markPrice) {
    throw new Error(`Runtime mark price not found for ${symbol}.`);
  }

  const price = String(markPrice.price);
  return [
    context.state.currentTime,
    price,
    price,
    price,
    price,
    "0",
    context.state.currentTime,
    "0",
    0,
    "0",
    "0",
    "",
    new Date(context.state.currentTime).toISOString(),
  ];
}

/** Evaluates the production exit model against cloned runtime state. */
async function findExit(
  context: RuntimeContext,
  position: Position,
): Promise<RuntimeExitDecision | null> {
  const symbol = position.symbol.toUpperCase();
  const accountConfig = context.helper.getAccountConfig(position.account);
  const config: DynamicTradeConfig = {
    ...context.state.config.management,
    ...accountConfig,
  } as DynamicTradeConfig;
  const clonedPosition = structuredClone(position);
  const volatilityPoints = structuredClone(
    context.state.vPointsMap[symbol] ?? [],
  );
  const memory: TradingModelMemory = {
    positions: [clonedPosition as TradingPosition],
    positionsSell: [],
    volatility: {
      symbol,
      lastVolatility: volatilityPoints,
    } as PredictionEngineMemory,
  };
  const tradeDecision = await trading.decision.exit({
    bypass: false,
    config,
    current: createCurrentKline(context, symbol),
    exchangeType: context.state.config.management.exchangeType,
    memory,
    symbol,
    tradingMode: context.state.config.management.tradingMode as TradingMode,
  });
  if (tradeDecision.action !== "SELL") return null;

  return {
    accountSlug: position.account,
    message: tradeDecision.reason ?? tradeDecision.log ?? "Exit approved",
    position,
    symbol,
    tradeDecision,
    type: "exit",
  };
}

/** Updates fee-aware PnL and its bounded configured history bucket. */
function updatePnl(context: RuntimeContext, position: Position): void {
  const markPrice = context.state.markPriceMap[position.symbol.toUpperCase()];
  if (!markPrice) {
    throw new Error(`Runtime mark price not found for ${position.symbol}.`);
  }

  if (
    !slowTrading.reporting.pnl.applyFloatingMetrics(
      position as TradingPosition,
      markPrice.price,
      context.state.config.management.exchangeType,
    )
  ) {
    return;
  }

  slowTrading.reporting.pnl.applyObservation(position as TradingPosition, {
    bucketMs: slowTrading.reporting.history.bucket.resolveMs(
      context.state.config.runtime.pnlHistoryBucketMinutes,
    ),
    pct: position.pnl.netPct ?? 0,
    replaceWithinBucket: true,
    timeMs: context.state.currentTime,
  });
}

/** Reclassifies a still-open position for its next monitoring pass. */
function updateMonitoringStage(
  context: RuntimeContext,
  position: Position,
): void {
  const accountConfig = context.helper.getAccountConfig(position.account);
  const volatilityPoints =
    context.state.vPointsMap[position.symbol.toUpperCase()] ?? [];
  const reasons = slowTrading.stages.position.getSpeedupReasons({
    latestVolatilityPoint: volatilityPoints.at(-1),
    negativePnlThresholdPct:
      context.state.config.runtime.speedupStageNegativePnlThresholdPct,
    positivePnlThresholdPct:
      context.state.config.runtime.speedupStagePositivePnlThresholdPct,
    position: position as TradingPosition,
    takeProfitOffsetPct:
      context.state.config.runtime.speedupStageTakeProfitOffsetPct,
    takeProfitPercent: accountConfig.takeProfitPercent,
    useStopLossPlus: accountConfig.useStopLossPlus,
    volatilityPoints,
  });
  const stage = reasons.length > 0 ? "speedup" : "standard";
  const reason =
    reasons.length > 0
      ? slowTrading.stages.position.describeSpeedupReasons(reasons)
      : slowTrading.stages.position.describeStandardReason({
          negativePnlThresholdPct:
            context.state.config.runtime.speedupStageNegativePnlThresholdPct,
          positivePnlThresholdPct:
            context.state.config.runtime.speedupStagePositivePnlThresholdPct,
          position: position as TradingPosition,
        });

  position.lastMonitoringStage = {
    lastUpdated: context.state.currentTime,
    reason,
    stage,
  };
}

const precisionStrategyBridge = {
  market: {
    getSymbols(config: RuntimeConfig): string[] {
      return slowTradingShared.symbols.buildExecution(
        config.management.symbols,
      );
    },
    createVPointMemory(params: {
      firstClose: number;
      firstTime: number;
    }): RuntimeVPointMemory {
      return {
        value: createPredictorMemory(params.firstClose, params.firstTime),
      };
    },
    processVPointKline(params: {
      kline: Kline;
      memory: RuntimeVPointMemory;
      previousPoint?: VolatilityPoint;
      symbol: string;
    }): {
      memory: RuntimeVPointMemory;
      point?: VolatilityPoint;
    } {
      const predicted = predictor(
        params.kline,
        params.memory.value as PredictorMemory,
        params.symbol,
      );
      const point = predicted.point;
      if (point) {
        const previousPoint = params.previousPoint;
        if (!previousPoint) {
          point.lvl = point.l === "T" ? 1 : -1;
        } else if (previousPoint.l !== point.l) {
          point.lvl =
            previousPoint.lvl === 0 ? (point.l === "T" ? 1 : -1) : 0;
        } else {
          point.lvl = previousPoint.lvl + (point.l === "T" ? 1 : -1);
        }
      }
      return {
        memory: { value: predicted.memory },
        point,
      };
    },
    detectVPoints(params: {
      klines: Kline[];
      previousPoint?: VolatilityPoint;
      symbol: string;
    }) {
      return precisionStrategy.market.detectVPoints(params);
    },
  },
  decisions: {
    findEntries,
    findAveraging,
    findExit,
  },
  positions: {
    updatePnl,
    updateMonitoringStage,
    markVPointUsed(params: {
      accountSlug: string;
      recommendation: EntryRecommendation | AveragingRecommendation;
      volatilityPoints?: VolatilityPoint[];
    }): void {
      slowTradingWatchReserve.volatilityPoint.markAccountUsed({
        accountSlug: params.accountSlug,
        entrySignal: params.recommendation,
        volatilityPoints: params.volatilityPoints,
      });
    },
  },
  // The contract requires actions; only the composed clean strategy below is
  // wired into production/dev, so these delegate to it lazily at call time.
  actions: {
    executeEntry(context: RuntimeContext, decision: RuntimeEntryDecision) {
      return precisionStrategy.actions.executeEntry(context, decision);
    },
    executeAveraging(
      context: RuntimeContext,
      decision: RuntimeAveragingDecision,
    ) {
      return precisionStrategy.actions.executeAveraging(context, decision);
    },
    executeExit(context: RuntimeContext, decision: RuntimeExitDecision) {
      return precisionStrategy.actions.executeExit(context, decision);
    },
  },
};

/**
 * The wired production/dev strategy: fully clean multi implementations for
 * the market, decision, position, and simulated-action ports, composed from
 * the system trading/utils modules and precision position bookkeeping.
 */
const precisionStrategy = {
  market: {
    getSymbols: tradingEntry.getSymbols,
    createVPointMemory: systemVpoints.createMemory,
    detectVPoints: systemVpoints.detectVPoints,
    processVPointKline: systemVpoints.processKline,
  },
  decisions: {
    findEntries: tradingEntry.findDecisions,
    findAveraging: tradingAveraging.findDecision,
    findExit: tradingExit.findDecision,
  },
  positions: systemPositions,
  actions: {
    executeEntry: entryAction.execute,
    executeAveraging: tradingAveraging.execute,
    executeExit: tradingExit.execute,
  },
} as const;

export default precisionStrategyBridge;
export { precisionStrategy, precisionStrategyBridge };
