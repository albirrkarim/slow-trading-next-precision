import type { AveragingRecommendation } from "@/lib/brain";
import type { DynamicTradeConfig } from "@/lib/dynamic";
import slowTradingWatchReserve from "@/lib/slowTrading/watch-reserve";
import type { Position } from "@/lib/trading/models";

import type {
  RuntimeAveragingDecision,
  RuntimeContext,
} from "../types";

/** Finds the existing production watch recommendation for one open position. */
async function find(
  context: RuntimeContext,
  position: Position,
): Promise<RuntimeAveragingDecision | null> {
  const accountConfig = context.helper.getAccountConfig(position.account);
  const balance = context.helper.getAccountBalance(position.account);
  const config: DynamicTradeConfig = {
    ...context.state.config.management,
    ...accountConfig,
  };
  const result = slowTradingWatchReserve.averaging.generateRecommendations({
    activePositions: [position],
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

const averaging = { find } as const;

export default averaging;
