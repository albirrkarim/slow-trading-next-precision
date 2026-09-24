import type { RuntimeContext } from "@/lib/precision/types";
import { TradingMode } from "@/lib/exchange/types";
import type { ExchangeAccountSlug } from "@/lib/exchange/account-context";
import type { BlackSwanState } from "./black-swan";
import type { RuntimeDailyPnlLimitEvaluation } from "./daily-pnl-limit";
import runtimeDailyPnlLimit from "./daily-pnl-limit";
import entryAction from "./entry-action";
import tradingEntry from "./entry";
import lateEntryVPointDrift from "./late-entry-vpoint-drift";
import autoRemove from "./auto-remove";
import type { BalanceSummary, EntryRecommendation } from "./types";

/** Current explanation for an actionable coin's entry outcome. */
export interface RuntimeEntryDiagnostic {
  code: string;
  level?: number;
  pointId?: string;
  reason: string;
  status: "blocked" | "ready";
  symbol: string;
}

/** Shared runtime control that applies before any account-specific entry work. */
export interface RuntimeSharedEntryGuardDiagnostic {
  code: string;
  reason: string;
  status: "blocked" | "ready";
}

/** Latest unresolved execution failure associated with one account. */
export interface RuntimeAccountExecutionError {
  createdAt: number;
  id: string;
  message: string;
}

/** Entry diagnostics evaluated with one enabled account's effective state. */
export interface RuntimeAccountEntryDiagnostics {
  account: {
    name: string;
    slug: ExchangeAccountSlug;
  };
  diagnosticError?: string;
  diagnostics: RuntimeEntryDiagnostic[];
  latestExecutionError?: RuntimeAccountExecutionError;
}

/** Complete dashboard snapshot of shared and per-account entry decisions. */
export interface RuntimeEntryDiagnosticsSnapshot {
  accounts: RuntimeAccountEntryDiagnostics[];
  generatedAt: number;
  sharedGuards: RuntimeSharedEntryGuardDiagnostic[];
}

function isActionable(pointLevel: unknown, minLevel: number): boolean {
  const level = Number(pointLevel);
  return Number.isFinite(level) && Math.abs(level) >= minLevel;
}

/**
 * Explains why the default decision pipeline skipped one actionable symbol:
 * the first applicable pre-execution gate, else a generic engine rejection.
 */
function explainMissingDecision(
  context: RuntimeContext,
  accountSlug: string,
  symbol: string,
): { code: string; reason: string } {
  const account = context.state.config.accounts.find(
    (item) => item.slug === accountSlug,
  );
  const accountPositions = context.state.openPositions.filter(
    (position) => position.account === accountSlug && !position.closed,
  );

  if (
    accountPositions.some(
      (position) => position.symbol.toUpperCase() === symbol,
    )
  ) {
    return {
      code: "OPEN_POSITION_EXISTS",
      reason: `Blocked because ${symbol} already has an open position.`,
    };
  }

  const lastPoint = context.state.vPointsMap[symbol]?.at(-1);
  if (
    tradingEntry.usage.isUsed({
      accountSlug,
      entrySignal: { id: String(lastPoint?.id ?? "") },
      volatilityPoints: context.state.vPointsMap[symbol],
    })
  ) {
    return {
      code: "VOLATILITY_POINT_USED",
      reason: `Blocked because this ${symbol} volatility point was already used by the account.`,
    };
  }

  if (
    context.state.config.management.tradingMode === TradingMode.SPOT &&
    lastPoint?.l === "T"
  ) {
    return {
      code: "SPOT_SHORT_BLOCKED",
      reason: "Blocked because Spot mode does not open SHORT entries.",
    };
  }

  // BOTH:AUTO_REMOVE_COIN_ABOVE_SOME_ABS_LEVEL — mirrors the signal-time
  // filter so the dashboard shows the same block the pipeline applied.
  const runtimeConfig = context.state.config.runtime;
  const autoRemoveAbsLevel = Math.max(
    0,
    Math.floor(Number(runtimeConfig.autoRemoveSymbolAbsLevel) || 0),
  );
  const lastLevel = Number(lastPoint?.lvl);
  if (
    autoRemoveAbsLevel > 0 &&
    Number.isFinite(lastLevel) &&
    Math.abs(lastLevel) >= autoRemoveAbsLevel
  ) {
    return {
      code: "AUTO_REMOVE_ABSOLUTE_LEVEL",
      reason:
        `Blocked because auto-removal will remove ${symbol} at absolute ` +
        `level ${Math.abs(lastLevel)} (configured threshold ` +
        `${autoRemoveAbsLevel}).`,
    };
  }

  // BOTH:BLOCK_ENTRY_BELOW_AUTO_REMOVE_MIN_PRICE — mirrors the
  // decision-time minimum-price filter in entry.findDecisions.
  const autoRemoveMinPrice = Math.max(
    0,
    Number(runtimeConfig.autoRemoveSymbolMinPrice) || 0,
  );
  const latestPrice = context.state.markPriceMap[symbol]?.price;
  if (
    autoRemove.price.isBelowMinimum({
      minimumPrice: autoRemoveMinPrice,
      price: latestPrice,
    })
  ) {
    return {
      code: "AUTO_REMOVE_MIN_PRICE",
      reason:
        `Blocked because ${symbol}'s current price ${latestPrice} USDT is ` +
        `below the configured coin-management minimum of ` +
        `${autoRemoveMinPrice} USDT.`,
    };
  }

  // BOTH:LATE_ENTRY_VPOINT_PRICE_DRIFT_PCT — mirrors the decision-time gate
  // so the dashboard explains the same block the pipeline applied.
  const drift = lateEntryVPointDrift.evaluate({
    currentPrice: context.state.markPriceMap[symbol]?.price,
    direction: lastPoint?.l === "B" ? "LONG" : "SHORT",
    enabled: account?.trading.lateEntryVPointPriceDriftEnabled,
    vPointPrice: Number(lastPoint?.p),
  });
  if (drift.blocked) {
    return {
      code: "LATE_ENTRY_VPOINT_PRICE_DRIFT",
      reason:
        drift.reason ??
        "Blocked because the current price already drifted too far " +
          "in the profit direction from the signal vPoint.",
    };
  }

  const maxOpenPositions = Math.max(
    0,
    Math.floor(Number(account?.trading.maxOpenPositions) || 0),
  );
  if (
    maxOpenPositions > 0 &&
    accountPositions.length >= maxOpenPositions
  ) {
    return {
      code: "MAX_OPEN_POSITIONS_REACHED",
      reason:
        `Blocked because the account already holds ` +
        `${accountPositions.length} open position(s) at the configured ` +
        `maximum of ${maxOpenPositions}.`,
    };
  }

  return {
    code: "DECISION_ENGINE_REJECTED",
    reason: `Blocked because the decision engine did not return ${symbol}.`,
  };
}

/**
 * Explains why an approved decision's entry plan cannot execute: mark price,
 * budget, or the funding-plan block code returned by the shared calculator.
 */
function explainRejectedPlan(
  context: RuntimeContext,
  decision: Parameters<typeof entryAction.plan>[1],
): { code: string; reason: string } {
  const mark = context.state.markPriceMap[decision.symbol];
  if (
    !mark ||
    !Number.isFinite(mark.price) ||
    mark.price <= 0
  ) {
    return {
      code: "MARK_PRICE_UNAVAILABLE",
      reason:
        "Blocked because the current market price required by entry funding is unavailable.",
    };
  }

  // BOTH:BLOCK_ENTRY_BELOW_AUTO_REMOVE_MIN_PRICE — mirrors the plan-time
  // guard; unlike drift it blocks manual entries too.
  const autoRemoveMinPrice = Math.max(
    0,
    Number(context.state.config.runtime.autoRemoveSymbolMinPrice) || 0,
  );
  if (
    autoRemove.price.isBelowMinimum({
      minimumPrice: autoRemoveMinPrice,
      price: mark.price,
    })
  ) {
    return {
      code: "AUTO_REMOVE_MIN_PRICE",
      reason:
        `Blocked because ${decision.symbol}'s latest price ${mark.price} ` +
        `USDT is below the configured coin-management minimum of ` +
        `${autoRemoveMinPrice} USDT.`,
    };
  }

  // BOTH:LATE_ENTRY_VPOINT_PRICE_DRIFT_PCT — mirrors the plan-time gate;
  // manual entries skip it exactly like the shared executor does.
  if (!decision.manual) {
    const drift = lateEntryVPointDrift.evaluate({
      currentPrice: mark.price,
      direction: decision.direction,
      enabled: context.helper.getAccountConfig(decision.accountSlug)
        .lateEntryVPointPriceDriftEnabled,
      vPointPrice: decision.entrySignal.p,
    });
    if (drift.blocked) {
      return {
        code: "LATE_ENTRY_VPOINT_PRICE_DRIFT",
        reason:
          drift.reason ??
          "Blocked because the current price already drifted too far " +
            "in the profit direction from the signal vPoint.",
      };
    }
  }

  const balance: BalanceSummary = context.helper.getAccountBalance(
    decision.accountSlug,
  );
  const spendable = Number.isFinite(balance.spendable)
    ? balance.spendable
    : balance.available - balance.reserved - balance.safeHaven;
  const requestedMarginUsdt = entryAction.funding.requestedMargin(
    decision,
    Math.max(0, spendable),
  );
  if (requestedMarginUsdt <= 0) {
    return {
      code: "ENTRY_BUDGET_BELOW_MINIMUM",
      reason:
        "Blocked because the selected entry margin is 0 USDT after probability sizing.",
    };
  }

  const account = context.state.config.accounts.find(
    (item) => item.slug === decision.accountSlug,
  );
  const config = {
    ...context.state.config.management,
    ...context.helper.getAccountConfig(decision.accountSlug),
  };
  const signal: EntryRecommendation = decision.entrySignal;
  const fundingPlan = entryAction.funding.calculate({
    activePositions: context.state.openPositions.filter(
      (position) => position.account === decision.accountSlug && !position.closed,
    ),
    config,
    direction: decision.direction,
    entryLevel: signal.lvl ?? 0,
    feeRate: context.adapter.exchange.getFeeRate({
      side: "buy",
      type: config.orderType ?? "taker",
    }),
    leverage: account
      ? Math.max(1, Number(signal.maxLeverage) || 1)
      : 1,
    requestedMarginUsdt,
    reservedQuoteAsset: balance.reserved,
    spendableQuoteAsset: Math.max(0, balance.available - balance.safeHaven),
    tradingMode: config.tradingMode,
  });

  if (fundingPlan.blockCode) {
    return {
      code: fundingPlan.blockCode,
      reason:
        fundingPlan.blockReason ??
        "Blocked because the entry funding plan rejected this trade.",
    };
  }

  return {
    code: "ENTRY_PLAN_REJECTED",
    reason:
      "Blocked because the shared entry funding plan rejected this trade.",
  };
}

/**
 * Builds the dashboard entry-diagnostics snapshot from the live runtime
 * pipeline: refreshes mark prices, then evaluates every enabled account's
 * configured symbols through the same decision and funding gates that drive
 * real entries.
 */
async function build(
  context: RuntimeContext,
  options?: {
    blackSwan?: BlackSwanState;
    /** Persisted daily-PnL entry-stop state re-evaluated for the current day. */
    dailyPnlLimit?: RuntimeDailyPnlLimitEvaluation;
    /** Latest unresolved error-log entry per account slug. */
    latestErrors?: Map<string, RuntimeAccountExecutionError>;
  },
): Promise<RuntimeEntryDiagnosticsSnapshot> {
  await context.helper.market.updateMarkPrice();

  const runtime = context.state.config.runtime;
  const sharedGuards: RuntimeSharedEntryGuardDiagnostic[] = [
    {
      code: "RUNNER_ENABLED",
      reason: runtime.runnerEnabled
        ? "The SLOW runner is enabled."
        : "The SLOW runner is disabled.",
      status: runtime.runnerEnabled ? "ready" : "blocked",
    },
    {
      code: "AUTO_ENTRY_ENABLED",
      reason: runtime.autoEntryEnabled
        ? "Automatic entry is enabled."
        : "Automatic entry is disabled.",
      status: runtime.autoEntryEnabled ? "ready" : "blocked",
    },
  ];

  const dailyPnlLimitReached = Boolean(options?.dailyPnlLimit?.reached);
  if (options?.dailyPnlLimit) {
    sharedGuards.push({
      code: "DAILY_PNL_LIMIT",
      reason: dailyPnlLimitReached
        ? runtimeDailyPnlLimit.guard.describe(options.dailyPnlLimit)
        : "Daily PnL is above the configured automatic-entry stop.",
      status: dailyPnlLimitReached ? "blocked" : "ready",
    });
  }

  const decisions = await tradingEntry.findDecisions(context);
  const decisionByKey = new Map(
    decisions.map((decision) => [
      `${decision.accountSlug}:${decision.symbol}`,
      decision,
    ]),
  );

  const accounts: RuntimeAccountEntryDiagnostics[] = [];
  const protectedByBlackSwan = Boolean(
    options?.blackSwan && options.blackSwan.status !== "NORMAL",
  );

  for (const account of context.state.config.accounts) {
    if (!account.enabled) continue;

    const diagnostics: RuntimeEntryDiagnostic[] = [];
    const minLevel = Math.max(
      1,
      Math.floor(Number(account.trading.minActionableAbsoluteLevel) || 2),
    );

    for (const rawSymbol of context.state.config.management.symbols) {
      const symbol = String(rawSymbol).trim().toUpperCase();
      if (!symbol || symbol === "BTC") continue;

      const point = context.state.vPointsMap[symbol]?.at(-1);
      const base = {
        level: point?.lvl,
        pointId: point?.id,
        symbol,
      };

      if (protectedByBlackSwan) {
        diagnostics.push({
          ...base,
          code: "BLACK_SWAN_PROTECTION",
          reason: `Blocked because Black Swan ${options?.blackSwan?.status} protection is active.`,
          status: "blocked",
        });
        continue;
      }

      if (dailyPnlLimitReached) {
        diagnostics.push({
          ...base,
          code: "DAILY_PNL_LIMIT",
          reason: runtimeDailyPnlLimit.guard.describe(
            options!.dailyPnlLimit!,
          ),
          status: "blocked",
        });
        continue;
      }

      if (!point || !isActionable(point.lvl, minLevel)) continue;

      const decision = decisionByKey.get(`${account.slug}:${symbol}`);
      if (decision) {
        const plan = entryAction.plan(context, decision);
        if (plan) {
          diagnostics.push({
            ...base,
            code: "READY",
            reason:
              "Ready: selected by the decision engine and every entry guard " +
              "passed; final exchange account, precision, and order checks " +
              "run during execution.",
            status: "ready",
          });
        } else {
          const blocked = explainRejectedPlan(context, decision);
          diagnostics.push({
            ...base,
            code: blocked.code,
            reason: blocked.reason,
            status: "blocked",
          });
        }
        continue;
      }

      const blocked = explainMissingDecision(
        context,
        account.slug,
        symbol,
      );
      diagnostics.push({
        ...base,
        code: blocked.code,
        reason: blocked.reason,
        status: "blocked",
      });
    }

    const latestExecutionError = options?.latestErrors?.get(account.slug);
    accounts.push({
      account: { name: account.name, slug: account.slug },
      diagnostics,
      ...(latestExecutionError ? { latestExecutionError } : {}),
    });
  }

  return {
    accounts,
    generatedAt: Date.now(),
    sharedGuards,
  };
}

const entryDiagnostics = {
  build,
} as const;

export default entryDiagnostics;
export { entryDiagnostics };
