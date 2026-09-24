import type {
  RuntimeContext,
  RuntimeEntryDecision,
} from "@/lib/precision/types";
import { TradingMode } from "@/lib/exchange/types";
import type { RuntimeConfig } from "../runtime";
import type { VolatilityPoint } from "../types";
import autoRemove from "./auto-remove";
import lateEntryVPointDrift from "./late-entry-vpoint-drift";
import type { EntryRecommendation, Position } from "./types";

const DEFAULT_MIN_ACTIONABLE_ABSOLUTE_LEVEL = 2;

/**
 * Normalizes the configured absolute immediate-entry threshold.
 */
function resolveMinActionableAbsoluteLevel(value?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_MIN_ACTIONABLE_ABSOLUTE_LEVEL;
  }

  return Math.max(1, Math.floor(value));
}

/**
 * Maps a value from an input scale to an output scale
 */
function mapScaleValue(
  inputMin: number,
  inputMax: number,
  value: number,
  outputMin: number,
  outputMax: number,
): number {
  // Ensure value is within input range
  const clampedValue = Math.max(inputMin, Math.min(inputMax, value));

  // Calculate the proportion of the value within the input range
  const inputRange = inputMax - inputMin;
  const proportion = (clampedValue - inputMin) / inputRange;

  // Map to output range
  const outputRange = outputMax - outputMin;
  return outputMin + proportion * outputRange;
}

/** Builds the persisted property name tracking entry usage for one account. */
function entryVolatilityPointUsageKey(accountSlug: string): string {
  return `usedBy${String(accountSlug || "").trim()}`;
}

/**
 * Checks whether the source volatility point for an entry signal is already
 * used: account markers win, callers without account identity read `used`.
 */
function isVolatilityPointUsed(params: {
  accountSlug?: string;
  entrySignal: Pick<VolatilityPoint, "id">;
  volatilityPoints?: VolatilityPoint[];
}): boolean {
  // BOTH:ENTRY_ONLY_IN_UNIQUE_VOLATILITY_POINT_ID
  const entryId = String(params.entrySignal.id || "").trim();
  if (!entryId) return false;

  const point = (params.volatilityPoints ?? []).find(
    (candidate) => String(candidate.id || "").trim() === entryId,
  );
  if (!point) return false;

  const accountSlug = String(params.accountSlug || "").trim();
  if (accountSlug) {
    return (
      (point as VolatilityPoint & Record<string, unknown>)[
        entryVolatilityPointUsageKey(accountSlug)
      ] === true
    );
  }

  return point.used === true;
}

/** Builds an account-scoped copy for the decision engine. */
function createAccountVolatilityMap(
  context: RuntimeContext,
  accountSlug: string,
) {
  return Object.fromEntries(
    Object.entries(context.state.vPointsMap).map(([symbol, points]) => [
      symbol,
      points.map((point) => ({
        ...point,
        used: isVolatilityPointUsed({
          accountSlug,
          entrySignal: point,
          volatilityPoints: points,
        }),
      })),
    ]),
  );
}

function makeEntryRecommendation(
  point: VolatilityPoint,
  minActionableAbsoluteLevel: number,
): EntryRecommendation {
  let amountProbab = 0;

  if (point.l === "B") {
    amountProbab = mapScaleValue(
      -1,
      -5,
      point.lvl,
      0.5,
      point.probability ?? 1,
    );
  }

  if (point.l === "T") {
    amountProbab = mapScaleValue(1, 5, point.lvl, 0.5, point.probability ?? 1);
  }

  const direction = point.l === "B" ? "LONG" : "SHORT";

  return {
    ...point,
    amountProbab,
    maxLeverage: 3,
    message:
      `decision.v20 ${direction}: absolute level ${Math.abs(point.lvl)} ` +
      `meets minimum ${minActionableAbsoluteLevel}`,
  };
}

/** Evaluates direct level-based v20 entry recommendations for one account. */
function evaluateRecommendations(
  context: RuntimeContext,
  accountSlug: string,
  minActionableAbsoluteLevel?: number,
): EntryRecommendation[] {
  const recommendations: EntryRecommendation[] = [];
  const resolvedMinActionableAbsoluteLevel =
    resolveMinActionableAbsoluteLevel(minActionableAbsoluteLevel);
  const autoRemoveAbsLevel = Math.max(
    0,
    Math.floor(
      Number(context.state.config.runtime.autoRemoveSymbolAbsLevel) || 0,
    ),
  );
  const volatilityPointsMap = createAccountVolatilityMap(context, accountSlug);

  for (const [symbol, points] of Object.entries(volatilityPointsMap)) {
    const currentPoint = points.at(-1);
    if (
      !currentPoint ||
      !(
        typeof currentPoint.lvl === "number" &&
        Number.isFinite(currentPoint.lvl) &&
        Math.abs(currentPoint.lvl) >= resolvedMinActionableAbsoluteLevel
      )
    ) {
      continue;
    }

    currentPoint.symbol = symbol;

    if (symbol === "BTC") {
      continue;
    }

    // BOTH:AUTO_REMOVE_COIN_ABOVE_SOME_ABS_LEVEL — the management cycle
    // retires a coin whose latest vPoint reaches this level, so a signal at
    // or above it must not become a new entry.
    if (
      autoRemoveAbsLevel > 0 &&
      Math.abs(currentPoint.lvl) >= autoRemoveAbsLevel
    ) {
      continue;
    }

    if (currentPoint.used) {
      continue;
    }

    // BOTH:DECISION_V20_LEVEL_GATE
    // v20 enters every unused latest point at or above the configured level.
    // It does not project lower levels or rank candidates by Speed timing.
    currentPoint.used = true;
    recommendations.push(
      makeEntryRecommendation(
        currentPoint,
        resolvedMinActionableAbsoluteLevel,
      ),
    );
  }

  return recommendations;
}

/** Finds entry decisions with the v20 recommendation engine for every account. */
async function findDecisions(
  context: RuntimeContext,
): Promise<RuntimeEntryDecision[]> {
  const decisions: RuntimeEntryDecision[] = [];
  const { config, openPositions, vPointsMap } = context.state;
  const configuredSymbols = new Set(
    config.management.symbols.map(autoRemove.symbol.normalize),
  );
  const autoRemoveMinPrice = Math.max(
    0,
    Number(config.runtime.autoRemoveSymbolMinPrice) || 0,
  );

  for (const account of config.accounts) {
    if (!account.enabled || !context.state.balance[account.slug]) continue;

    const accountPositions = openPositions.filter(
      (position) => position.account === account.slug && !position.closed,
    );
    // BOTH:MAX_OPEN_POSITIONS_ENTRY_GUARD
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

    const recommendations = evaluateRecommendations(
      context,
      account.slug,
      account.trading.minActionableAbsoluteLevel,
    );

    for (const entrySignal of recommendations) {
      const symbol = autoRemove.symbol.normalize(entrySignal.symbol);
      if (!symbol) continue;
      // BOTH:AUTO_REMOVE_CONFIGURED_SYMBOL_GUARD — a coin the management
      // cycle removed from the configured list cannot produce new entries.
      if (!configuredSymbols.has(symbol)) continue;
      if (
        config.management.tradingMode === TradingMode.SPOT &&
        entrySignal.l !== "B"
      ) {
        continue;
      }
      // BOTH:BLOCK_ENTRY_BELOW_AUTO_REMOVE_MIN_PRICE — decision-time check
      // on the latest mark; the execution boundary re-checks it against the
      // freshest catalog and mark before the fill.
      if (
        autoRemove.price.isBelowMinimum({
          minimumPrice: autoRemoveMinPrice,
          price: context.state.markPriceMap[symbol]?.price,
        })
      ) {
        continue;
      }
      // BOTH:ONLY_ONE_ACTIVE_POSITION_PER_COIN
      if (
        accountPositions.some(
          (position) => position.symbol.toUpperCase() === symbol,
        )
      ) {
        continue;
      }
      if (
        isVolatilityPointUsed({
          accountSlug: account.slug,
          entrySignal,
          volatilityPoints: vPointsMap[symbol],
        })
      ) {
        continue;
      }

      // BOTH:LATE_ENTRY_VPOINT_PRICE_DRIFT_PCT — decision-time check. A
      // signal whose current mark already drifted past the profitable-move
      // cap is skipped; the execution-time check in entryAction re-runs it
      // on the freshest mark before the fill. Blocked points stay unused.
      const drift = lateEntryVPointDrift.evaluate({
        currentPrice: context.state.markPriceMap[symbol]?.price,
        direction: entrySignal.l === "B" ? "LONG" : "SHORT",
        enabled: account.trading.lateEntryVPointPriceDriftEnabled,
        vPointPrice: entrySignal.p,
      });
      if (drift.blocked) continue;

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

/**
 * Builds the execution symbol list: configured symbols, symbols that still
 * carry an open position, plus BTC context. A coin the management cycle
 * removed keeps its market sync while its position stays managed.
 */
function getSymbols(
  config: RuntimeConfig,
  positions?: Position[],
): string[] {
  const out = new Set(
    config.management.symbols.map((symbol) => symbol.toUpperCase()),
  );
  // PROD:AUTO_REMOVE_COIN_WITH_OPEN_POSITION
  for (const position of positions ?? []) {
    if (!position.closed) {
      out.add(autoRemove.symbol.normalize(position.symbol));
    }
  }
  out.add("BTC");
  const list = [...out];
  list.sort((a, b) => a.localeCompare(b));
  return list;
}

const entry = {
  findDecisions,
  getSymbols,
  threshold: {
    resolve: resolveMinActionableAbsoluteLevel,
  },
  usage: {
    isUsed: isVolatilityPointUsed,
  },
} as const;

export default entry;
