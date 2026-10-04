import type {
  RuntimeContext,
  RuntimeEntryDecision,
} from "@/lib/precision/types";
import { TradingMode } from "@/lib/exchange/types";
import { resolveVolatilityThreshold } from "../constants";
import type { RuntimeAccountTradingConfig, RuntimeConfig } from "../runtime";
import type { VolatilityPoint } from "../types";
import vpoints from "../utils/vpoints";
import autoRemove from "./auto-remove";
import lateEntryVPointDrift from "./late-entry-vpoint-drift";
import type {
  EntryRecommendation,
  Position,
  PositionDirection,
} from "./types";

/**
 * Normalizes an optional inclusive absolute entry-level bound.
 */
function resolveEntryAbsLevel(value?: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : undefined;
}

/** Checks one absolute level against both optional inclusive entry bounds. */
function isWithinEntryAbsLevel(
  level: number,
  minEntryAbsLevel?: number,
  maxEntryAbsLevel?: number,
): boolean {
  if (!Number.isFinite(level)) return false;
  const absoluteLevel = Math.abs(level);
  const min = resolveEntryAbsLevel(minEntryAbsLevel);
  const max = resolveEntryAbsLevel(maxEntryAbsLevel);
  return (min === undefined || absoluteLevel >= min) &&
    (max === undefined || absoluteLevel <= max);
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

/**
 * Checks whether the source volatility point for an entry signal is already
 * used: with an account slug it matches that account's markers
 * (`"<slug>"` or per-leg `"<slug>:<ROLE>"`); without one, any marker means
 * consumed.
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
    return vpoints.usage.hasAccount(point, accountSlug);
  }

  return (point.usedBy ?? []).length > 0;
}

function makeEntryRecommendation(
  point: VolatilityPoint,
  minEntryAbsLevel?: number,
  maxEntryAbsLevel?: number,
): EntryRecommendation {
  let amountProbab = 0;

  if (point.l === "B") {
    amountProbab = mapScaleValue(-1, -5, point.lvl, 0.5, 1);
  }

  if (point.l === "T") {
    amountProbab = mapScaleValue(1, 5, point.lvl, 0.5, 1);
  }

  const direction = point.l === "B" ? "LONG" : "SHORT";
  const bounds = [
    minEntryAbsLevel === undefined ? null : `minimum ${minEntryAbsLevel}`,
    maxEntryAbsLevel === undefined ? null : `maximum ${maxEntryAbsLevel}`,
  ].filter(Boolean);

  return {
    ...point,
    amountProbab,
    maxLeverage: 3,
    message:
      `decision.v20 ${direction}: absolute level ${Math.abs(point.lvl)} ` +
      (bounds.length > 0
        ? `meets ${bounds.join(" and ")}`
        : "has no entry level bound"),
  };
}

/**
 * Resolves the account's forming-vPoint entry settings: enabled flag and
 * normalized percents — favorable must be finite `> 0` (default 3),
 * adverse finite `>= 0` (default 2).
 */
function resolveFormingSettings(
  trading: Pick<
    RuntimeAccountTradingConfig,
    | "formingVPointEntryEnabled"
    | "formingVPointEntryFavorablePct"
    | "formingVPointEntryAdversePct"
  >,
): { adversePct: number; enabled: boolean; favorablePct: number } {
  const favorable = Number(trading.formingVPointEntryFavorablePct);
  const adverse = Number(trading.formingVPointEntryAdversePct);
  return {
    adversePct: Number.isFinite(adverse) && adverse >= 0 ? adverse : 2,
    enabled: trading.formingVPointEntryEnabled === true,
    favorablePct:
      Number.isFinite(favorable) && favorable > 0 ? favorable : 3,
  };
}

/**
 * BOTH:FORMING_VPOINT_ENTRY — resolves the forming direction from the
 * latest point's running excursions: `maxDownPct >= F && maxUpPct < A`
 * means a BOTTOM is still forming (SHORT), `maxUpPct >= F && maxDownPct <
 * A` means a TOP is still forming (LONG). Missing excursions read as 0;
 * the adverse comparison is strict. When both qualify (only possible
 * when `A > F`) the larger favorable excursion wins; a tie yields null.
 */
function resolveFormingDirection(
  point: Pick<VolatilityPoint, "maxDownPct" | "maxUpPct">,
  favorablePct: number,
  adversePct: number,
): PositionDirection | null {
  const down = Number(point.maxDownPct) || 0;
  const up = Number(point.maxUpPct) || 0;
  const short = down >= favorablePct && up < adversePct;
  const long = up >= favorablePct && down < adversePct;
  if (short && long) {
    if (down === up) return null;
    return down > up ? "SHORT" : "LONG";
  }
  if (short) return "SHORT";
  if (long) return "LONG";
  return null;
}

/** Evaluates direct level-based v20 entry recommendations for one account. */
function evaluateRecommendations(
  context: RuntimeContext,
  accountSlug: string,
  trading: RuntimeAccountTradingConfig,
): Array<{
  direction: PositionDirection;
  entrySignal: EntryRecommendation;
}> {
  const recommendations: Array<{
    direction: PositionDirection;
    entrySignal: EntryRecommendation;
  }> = [];
  const resolvedMinEntryAbsLevel = resolveEntryAbsLevel(
    trading.minEntryAbsLevel,
  );
  const resolvedMaxEntryAbsLevel = resolveEntryAbsLevel(
    trading.maxEntryAbsLevel,
  );
  const forming = resolveFormingSettings(trading);
  const autoRemoveAbsLevel = Math.max(
    0,
    Math.floor(
      Number(context.state.config.runtime.autoRemoveSymbolAbsLevel) || 0,
    ),
  );
  for (const [symbol, points] of Object.entries(context.state.vPointsMap)) {
    const currentPoint = points.at(-1);
    if (
      !currentPoint ||
      !isWithinEntryAbsLevel(
        currentPoint.lvl,
        resolvedMinEntryAbsLevel,
        resolvedMaxEntryAbsLevel,
      )
    ) {
      continue;
    }

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

    // BOTH:DECISION_V20_LEVEL_GATE
    // v20 enters every unused latest point inside the configured range.
    // It does not project lower levels or rank candidates by Speed timing.
    if (
      isVolatilityPointUsed({
        accountSlug,
        entrySignal: currentPoint,
        volatilityPoints: points,
      })
    ) {
      continue;
    }

    const recommendation = makeEntryRecommendation(
      currentPoint,
      resolvedMinEntryAbsLevel,
      resolvedMaxEntryAbsLevel,
    );
    recommendation.symbol = symbol;

    // BOTH:FORMING_VPOINT_ENTRY — when enabled the forming rule replaces
    // the normal entry entirely: a point whose excursions do not qualify
    // produces no signal at all.
    if (forming.enabled) {
      const direction = resolveFormingDirection(
        currentPoint,
        forming.favorablePct,
        forming.adversePct,
      );
      if (direction === null) continue;
      recommendation.forming = true;
      const down = Number(currentPoint.maxDownPct) || 0;
      const up = Number(currentPoint.maxUpPct) || 0;
      recommendation.message =
        direction === "SHORT"
          ? `forming-vpoint SHORT: ${currentPoint.l} ${currentPoint.id} ` +
            `↓${down.toFixed(2)}% ≥ ${forming.favorablePct}% ` +
            `and ↑${up.toFixed(2)}% < ${forming.adversePct}%`
          : `forming-vpoint LONG: ${currentPoint.l} ${currentPoint.id} ` +
            `↑${up.toFixed(2)}% ≥ ${forming.favorablePct}% ` +
            `and ↓${down.toFixed(2)}% < ${forming.adversePct}%`;
      recommendations.push({ direction, entrySignal: recommendation });
      continue;
    }

    recommendations.push({
      direction: currentPoint.l === "B" ? "LONG" : "SHORT",
      entrySignal: recommendation,
    });
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
      account.trading,
    );

    for (const { direction, entrySignal } of recommendations) {
      const symbol = autoRemove.symbol.normalize(entrySignal.symbol);
      if (!symbol) continue;
      // BOTH:AUTO_REMOVE_CONFIGURED_SYMBOL_GUARD — a coin the management
      // cycle removed from the configured list cannot produce new entries.
      if (!configuredSymbols.has(symbol)) continue;
      if (
        config.management.tradingMode === TradingMode.SPOT &&
        direction !== "LONG"
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
      // Forming-vPoint signals are exempt — they by definition drifted the
      // favorable percent that qualified them (BOTH:FORMING_VPOINT_ENTRY).
      if (!entrySignal.forming) {
        const drift = lateEntryVPointDrift.evaluate(
          {
            currentPrice: context.state.markPriceMap[symbol]?.price,
            direction,
            enabled: account.trading.lateEntryVPointPriceDriftEnabled,
            limitPct: account.trading.lateEntryVPointPriceDriftPct,
            vPointPrice: entrySignal.p,
          },
          resolveVolatilityThreshold(context.state.config.management),
        );
        if (drift.blocked) continue;
      }

      decisions.push({
        accountSlug: account.slug,
        direction,
        entrySignal,
        message: entrySignal.message,
        symbol,
        type: "entry",
        vPointUsage: [account.slug],
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
  forming: {
    direction: resolveFormingDirection,
    settings: resolveFormingSettings,
  },
  getSymbols,
  recommendation: {
    /**
     * Builds an `EntryRecommendation` from an arbitrary volatility point —
     * strategy producers reuse it for re-entry anchors where the candidate
     * point is not the symbol's latest.
     */
    make: makeEntryRecommendation,
  },
  threshold: {
    resolve: resolveEntryAbsLevel,
    resolveMax: resolveEntryAbsLevel,
    contains: isWithinEntryAbsLevel,
  },
  usage: {
    isUsed: isVolatilityPointUsed,
  },
} as const;

export default entry;
