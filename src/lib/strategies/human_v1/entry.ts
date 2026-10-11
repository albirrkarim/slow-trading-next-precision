import { TradingMode } from "@/lib/exchange/types";
import type { RuntimeContext, RuntimeEntryDecision } from "@/lib/precision/types";
import autoRemove from "@/lib/system/trading/auto-remove";
import type { EntryRecommendation } from "@/lib/system/trading/types";

import humanSignal from "./signal";
import humanState from "./state";

/** Fixed sizing weight — the default strategy's level-1 allocation. */
export const HUMAN_V1_AMOUNT_PROBAB = 0.5;

/**
 * Minimum mark distance from the EMA, pct, in the cross (and Supertrend)
 * direction before an armed cross enters — filters whipsaw crosses that
 * barely clear the EMA.
 */
export const HUMAN_V1_MIN_EMA_DISTANCE_PCT = 2
const MAX_LEVERAGE = 3;

/** Strategy payload copied onto `position.strategy.logic` at commit. */
export interface HumanV1Logic {
  v: "human_v1";
  /** EMA instance the position's cross-back exit watches. */
  emaId: string;
}

/** A confirmed entry signal for one coin. */
interface HumanSignal {
  direction: 1 | -1;
  emaId: string;
  emaValue: number;
  markPrice: number;
  distancePct: number;
  supertrendIds: string[];
}

/**
 * Scans every configured coin once per capture pass:
 * 1. records its EMA side; a flip since the previous pass arms that
 *    direction (the first observation only seeds — no mid-trend entry on
 *    boot);
 * 2. an armed direction becomes a signal once the mark is at least
 *    `HUMAN_V1_MIN_EMA_DISTANCE_PCT` beyond the EMA that way and every
 *    Supertrend agrees — the arm is then consumed.
 * A cross back re-arms the other direction, dropping the stale one.
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
    if (reading.missing || !reading.side) continue;
    const previous = state.side[symbol];
    state.side[symbol] = reading.side;
    if (previous !== undefined && previous !== reading.side) {
      state.armed[symbol] = reading.side;
    }
    // BOTH:HUMAN_V1_ENTRY — armed EMA cross, ≥ min distance beyond the
    // EMA, confirmed by every Supertrend.
    if (state.armed[symbol] !== reading.side) continue;
    if (reading.consensus !== reading.side) continue;
    const distancePct = reading.distancePct as number;
    if (reading.side * distancePct < HUMAN_V1_MIN_EMA_DISTANCE_PCT) continue;
    delete state.armed[symbol];
    signals.set(symbol, {
      direction: reading.side,
      distancePct,
      emaId: reading.emaId as string,
      emaValue: reading.emaValue as number,
      markPrice: reading.markPrice as number,
      supertrendIds: reading.supertrendIds,
    });
  }
  return signals;
}

/** Synthetic vPoint-shaped signal the shared execution path sizes and records. */
function recommendation(context: RuntimeContext, symbol: string, signal: HumanSignal): EntryRecommendation {
  const label = signal.direction === 1 ? "LONG" : "SHORT";
  const t = context.state.currentTime;
  return {
    amountProbab: HUMAN_V1_AMOUNT_PROBAB,
    // `H_` ids never match a real vPoint, so no point gets marked used.
    id: `H_${symbol}_${t}`,
    l: signal.direction === 1 ? "B" : "T",
    lvl: signal.direction,
    maxLeverage: MAX_LEVERAGE,
    message:
      `human_v1 ${label}: ${signal.supertrendIds.join(", ")} all ${signal.direction === 1 ? "up" : "down"}; ` +
      `mark ${signal.markPrice} crossed ${signal.direction === 1 ? "above" : "below"} ${signal.emaId} ${signal.emaValue} ` +
      `(${signal.distancePct > 0 ? "+" : ""}${signal.distancePct.toFixed(2)}%)`,
    p: signal.markPrice,
    pct: 0,
    symbol,
    t,
    vb: 0,
    vq: 0,
  };
}

/**
 * Entry producer: one candidate per account and fresh signal, behind the
 * same protections as the default producer — enabled account with
 * balance, max open positions, configured coin, no shorts in spot, the
 * auto-remove minimum price, and one active position per coin.
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
