import brain from "@/lib/brain";
import { TradingMode } from "@/lib/exchange";
import slowTradingWatchReserve from "@/lib/slowTrading/watch-reserve";

import type { RuntimeContext, RuntimeEntryDecision } from "../types";

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
async function find(context: RuntimeContext): Promise<RuntimeEntryDecision[]> {
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

const entry = { find } as const;

export default entry;
