import { TradingMode } from "@/lib/exchange/types";
import type { EntryRecommendation } from "@/lib/system/trading";
import type {
  RuntimeContext,
  RuntimeEntryDecision,
} from "../types";
import entryMonitoring from "./entry";
import positionMonitoring from "./position";
import stages from "./stages";

/** Operator-forced entry scope: one account plus its symbols. */
export interface RuntimeManualEntryScope {
  accountSlug: string;
  symbols: string[];
}

/** Operator-forced exit scope: symbols, optionally narrowed to one account. */
export interface RuntimeManualExitScope {
  accountSlug?: string;
  symbols: string[];
}

export interface RuntimeManualPassParams {
  /** Forced entries; each bypasses the auto-entry gate (still level-gated). */
  forceEntries?: RuntimeManualEntryScope[];
  /** Forced exits; each flags `control.forceExit` then monitors the position. */
  forceExits?: RuntimeManualExitScope[];
  /** Skip the default entry-capture stage of the pass. */
  disableEntry?: boolean;
  /** Relax the forced-entry level gate to any non-neutral latest point. */
  bypass?: boolean;
}

export interface RuntimeManualEntryOutcome {
  accountSlug: string;
  executed: boolean;
  message?: string;
  symbol: string;
}

export interface RuntimeManualExitOutcome {
  accountSlug: string;
  closed: boolean;
  message?: string;
  symbol: string;
}

export interface RuntimeManualPassResult {
  entries: RuntimeManualEntryOutcome[];
  exits: RuntimeManualExitOutcome[];
  /** Open positions present when the monitoring stages ran. */
  monitored: number;
  ranAt: number;
}

function normalizeSymbol(symbol: string): string {
  return String(symbol || "").trim().toUpperCase();
}

function minActionableLevel(accountSlug: string, context: RuntimeContext) {
  const configured = context.state.config.accounts.find(
    (account) => account.slug === accountSlug,
  )?.trading.minActionableAbsoluteLevel;
  const parsed = Number(configured);
  return Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : 2;
}

/**
 * Builds an operator-forced entry decision from the symbol's latest volatility
 * point, or returns the skip reason when the symbol cannot be entered.
 */
function buildForcedEntryDecision(
  context: RuntimeContext,
  accountSlug: string,
  symbol: string,
  bypass?: boolean,
): RuntimeEntryDecision | string {
  const account = context.state.config.accounts.find(
    (item) => item.slug === accountSlug,
  );
  if (!account) return `Account ${accountSlug} not found`;
  if (!account.enabled) {
    return `Account ${accountSlug} is disabled for new entries`;
  }

  const hasOpenPosition = context.state.openPositions.some(
    (position) =>
      position.account === accountSlug &&
      !position.closed &&
      position.symbol.toUpperCase() === symbol,
  );
  if (hasOpenPosition) {
    return `Open position already exists for ${symbol}`;
  }

  const lastPoint = context.state.vPointsMap[symbol]?.at(-1);
  if (!lastPoint) return `No volatility point available for ${symbol}`;

  const minLevel = minActionableLevel(accountSlug, context);
  const level = Number(lastPoint.lvl);
  const actionable = Number.isFinite(level) && Math.abs(level) >= minLevel;
  if (bypass ? level === 0 || !Number.isFinite(level) : !actionable) {
    return bypass
      ? `Latest ${symbol} volatility point is neutral`
      : `Latest ${symbol} volatility level ${lastPoint.lvl} below minimum ${minLevel}`;
  }

  if (
    context.state.config.management.tradingMode === TradingMode.SPOT &&
    lastPoint.l !== "B"
  ) {
    return `Spot mode cannot take ${lastPoint.l} signals`;
  }

  const entrySignal: EntryRecommendation = {
    ...lastPoint,
    amountProbab: 1,
    maxLeverage: 2,
    message: `manual${bypass ? " bypass" : ""} entry by operator`,
    symbol,
  };

  return {
    accountSlug,
    direction: lastPoint.l === "B" ? "LONG" : "SHORT",
    entrySignal,
    manual: true,
    message: entrySignal.message,
    symbol,
    type: "entry",
  };
}

/**
 * Runs one operator-initiated pass over the shared runtime context: refreshes
 * market state, applies forced exits, runs both monitoring stages regardless
 * of their schedule, executes forced entries, then the default entry capture.
 */
async function run(
  context: RuntimeContext,
  params: RuntimeManualPassParams = {},
): Promise<RuntimeManualPassResult> {
  context.state.currentTime = context.adapter.clock.now();
  await context.helper.market.updateMarkPrice();
  await context.helper.market.updateVPointsMap();

  const result: RuntimeManualPassResult = {
    entries: [],
    exits: [],
    monitored: 0,
    ranAt: context.state.currentTime,
  };

  // 1. Forced exits first: operator intent releases margin before anything
  // else in the pass can consume it.
  for (const scope of params.forceExits ?? []) {
    const symbols = new Set(scope.symbols.map(normalizeSymbol));
    for (const position of [...context.state.openPositions]) {
      if (position.closed) continue;
      if (scope.accountSlug && position.account !== scope.accountSlug) {
        continue;
      }
      if (!symbols.has(position.symbol.toUpperCase())) continue;

      position.control = {
        ...position.control,
        forceExit: { reason: "manual api" },
      };
      await positionMonitoring.monitor(context, position);
      result.exits.push({
        accountSlug: position.account,
        closed: !context.state.openPositions.includes(position),
        symbol: position.symbol.toUpperCase(),
      });
    }
  }

  // 2. Monitoring stages run unconditionally; the per-position lastUpdated
  // guard inside each stage still dedupes positions handled by forced exits.
  result.monitored = context.state.openPositions.length;
  await stages.standard(context);
  await stages.speedup(context);

  // 3. Forced entries: same decision → strategy → action → bookkeeping path
  // as the default capture, marked manual so the adapter bypasses the
  // auto-entry gate for an explicit operator request.
  for (const scope of params.forceEntries ?? []) {
    for (const rawSymbol of scope.symbols) {
      const symbol = normalizeSymbol(rawSymbol);
      if (!symbol) continue;
      const decision = buildForcedEntryDecision(
        context,
        scope.accountSlug,
        symbol,
        params.bypass,
      );
      if (typeof decision === "string") {
        result.entries.push({
          accountSlug: scope.accountSlug,
          executed: false,
          message: decision,
          symbol,
        });
        continue;
      }

      const position = await entryMonitoring.executeDecision(
        context,
        decision,
      );
      result.entries.push({
        accountSlug: scope.accountSlug,
        executed: Boolean(position),
        message: position ? decision.message : "Entry action declined",
        symbol,
      });
    }
  }

  // 4. Default entry capture, unless the caller only wanted monitoring/exits.
  if (!params.disableEntry) {
    await entryMonitoring.capture(context);
  }

  return result;
}

const manual = {
  run,
} as const;

export default manual;
export { run };
