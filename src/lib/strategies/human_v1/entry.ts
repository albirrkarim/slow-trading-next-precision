import { TradingMode } from "@/lib/exchange/types";
import type { RuntimeContext, RuntimeEntryDecision } from "@/lib/precision/types";
import autoRemove from "@/lib/system/trading/auto-remove";
import type { EntryRecommendation } from "@/lib/system/trading/types";

import humanSetup, { HUMAN_V1_TP_R, type HumanSetup } from "./setup";
import humanSignal from "./signal";
import humanState from "./state";

/** Fixed sizing weight — the default strategy's level-1 allocation. */
export const HUMAN_V1_AMOUNT_PROBAB = 0.5;
const MAX_LEVERAGE = 3;

/** Strategy payload copied onto `position.strategy.logic` at commit. */
export interface HumanV1Logic {
  v: "human_v1";
  /** EMA instance the setup was measured against. */
  emaId: string;
}

interface HumanSignal extends HumanSetup {
  emaId: string;
  supertrendIds: string[];
}

/**
 * Scans every configured coin once per capture pass and returns its fresh
 * setup. An alignment (identified by its newest Supertrend flip) is
 * consumed when it produces a signal, so it never enters twice.
 */
function scanSignals(context: RuntimeContext): Map<string, HumanSignal> {
  const state = humanState.read(context);
  const signals = new Map<string, HumanSignal>();
  const configured = context.state.config.management.symbols.map(autoRemove.symbol.normalize);
  for (const symbol of configured) {
    if (!symbol || symbol === "BTC") continue;
    const reading = humanSignal.read(
      context.state.features,
      symbol,
      context.state.markPriceMap[symbol]?.price,
    );
    const result = humanSetup.evaluate(reading, context.state.currentTime);
    if (!("setup" in result) || state.used[symbol] === result.setup.flipT) continue;
    state.used[symbol] = result.setup.flipT;
    signals.set(symbol, {
      ...result.setup,
      emaId: reading.emaId as string,
      supertrendIds: reading.supertrend.ids,
    });
  }
  return signals;
}

/** "LONG: st1, st2, st3 flipped up together, lines collide; mark 105 above ema200 97 | TP 123 (2R) · SL 96 (slowest line)" */
function describe(signal: HumanSignal): string {
  const long = signal.direction === 1;
  return (
    `human_v1 ${long ? "LONG" : "SHORT"}: ${signal.supertrendIds.join(", ")} flipped ${long ? "up" : "down"} together, lines collide; ` +
    `mark ${signal.markPrice} above ${signal.emaId} ${signal.emaValue} | ` +
    `TP ${signal.plan.tp} (${HUMAN_V1_TP_R}R) · SL ${signal.plan.sl} (slowest Supertrend line)`
  );
}

/** Synthetic vPoint-shaped signal the shared execution path sizes and records. */
function recommendation(context: RuntimeContext, symbol: string, signal: HumanSignal): EntryRecommendation {
  const t = context.state.currentTime;
  return {
    amountProbab: HUMAN_V1_AMOUNT_PROBAB,
    // `H_` ids never match a real vPoint, so no point gets marked used.
    id: `H_${symbol}_${t}`,
    l: signal.direction === 1 ? "B" : "T",
    lvl: signal.direction,
    maxLeverage: MAX_LEVERAGE,
    message: describe(signal),
    p: signal.markPrice,
    pct: 0,
    symbol,
    t,
    vb: 0,
    vq: 0,
  };
}

/**
 * Entry producer: one candidate per account and fresh setup, carrying the
 * setup's TP/SL as the position plan, behind the same protections as the
 * default producer — enabled account with balance, max open positions,
 * configured coin, no shorts in spot, the auto-remove minimum price, and
 * one active position per coin.
 */
async function find(context: RuntimeContext): Promise<RuntimeEntryDecision[]> {
  const signals = scanSignals(context);
  if (signals.size === 0) return [];
  const { config, openPositions } = context.state;
  const minPrice = Math.max(0, Number(config.runtime.autoRemoveSymbolMinPrice) || 0);
  const decisions: RuntimeEntryDecision[] = [];

  for (const account of config.accounts) {
    if (!account.enabled || !context.state.balance[account.slug]) continue;
    const accountPositions = openPositions.filter(
      (position) => position.account === account.slug && !position.closed,
    );
    const maxOpenPositions = Math.max(0, Math.floor(Number(account.trading.maxOpenPositions) || 0));

    for (const [symbol, signal] of signals) {
      if (maxOpenPositions > 0 && accountPositions.length >= maxOpenPositions) break;
      if (config.management.tradingMode === TradingMode.SPOT && signal.direction === -1) continue;
      if (autoRemove.price.isBelowMinimum({ minimumPrice: minPrice, price: signal.markPrice })) continue;
      if (accountPositions.some((position) => position.symbol.toUpperCase() === symbol)) continue;

      const entrySignal = recommendation(context, symbol, signal);
      const logic: HumanV1Logic = { emaId: signal.emaId, v: "human_v1" };
      decisions.push({
        accountSlug: account.slug,
        direction: signal.direction === 1 ? "LONG" : "SHORT",
        entrySignal,
        message: entrySignal.message,
        plan: { ...signal.plan },
        strategy: logic,
        symbol,
        type: "entry",
      });
    }
  }
  return decisions;
}

const humanEntry = { find, scanSignals } as const;

export default humanEntry;
