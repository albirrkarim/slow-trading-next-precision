import { VOLATILITY_THRESHOLD } from "@/lib/system/constants";
import autoRemove from "@/lib/system/trading/auto-remove";
import runtimeDailyPnlLimit from "@/lib/system/trading/daily-pnl-limit";
import type { RuntimeAccountConfig } from "@/lib/system/runtime";
import type {
  RuntimeContext,
  RuntimeEngineState,
  RuntimeEntryDecision,
} from "../types";

/** Resolves today's accumulated closed-trade PnL, resetting on UTC rollover. */
function resolveDailyPnlUsdt(state: RuntimeEngineState): number {
  const day = runtimeDailyPnlLimit.period.getCurrentUtc(
    state.currentTime,
  ).day;
  return state.dailyPnlDay === day ? (state.dailyPnlUsdt ?? 0) : 0;
}

/**
 * Adds one closed trade's net USDT PnL to the state accumulator; called once
 * per close from the shared exit path so every environment counts closes
 * identically.
 */
function recordClosedPnlUsdt(
  state: RuntimeEngineState,
  netUsdt?: number,
): void {
  if (!Number.isFinite(netUsdt)) return;
  const day = runtimeDailyPnlLimit.period.getCurrentUtc(
    state.currentTime,
  ).day;
  if (state.dailyPnlDay !== day) {
    state.dailyPnlDay = day;
    state.dailyPnlUsdt = 0;
  }
  state.dailyPnlUsdt = (state.dailyPnlUsdt ?? 0) + (netUsdt ?? 0);
}

/**
 * Per-attempt slot inventory — candidates execute one at a time and
 * `state.openPositions` mutates between attempts, so same-symbol dedupe and
 * max-open are re-verified inside the gate (before the manual bypass in
 * `policy`, since slot limits hold for forced entries too). Exposed
 * separately so a strategy gate replaces it — e.g. `both` dedupes by pair
 * role and counts pairs — while still composing `policy`.
 */
function capacity(
  decision: RuntimeEntryDecision,
  context: RuntimeContext,
  account: RuntimeAccountConfig,
): boolean {
  const openPositions = context.state.openPositions.filter(
    (position) =>
      position.account === decision.accountSlug && !position.closed,
  );
  if (
    openPositions.some(
      (position) => position.symbol.toUpperCase() === decision.symbol,
    )
  ) {
    return false;
  }
  const maximum = Math.max(
    0,
    Math.floor(Number(account.trading.maxOpenPositions) || 0),
  );
  return maximum === 0 || openPositions.length < maximum;
}

/**
 * Shared entry policy — symbol catalog, minimum price, stale-signal veto,
 * manual bypass, auto-entry toggle, entry cutoff, daily-PnL stop. Exposed
 * separately so a strategy gate keeps it while replacing `capacity`.
 */
function policy(
  decision: RuntimeEntryDecision,
  context: RuntimeContext,
): boolean {
  const state = context.state;

  // BOTH:AUTO_REMOVE_CONFIGURED_SYMBOL_GUARD /
  // BOTH:BLOCK_ENTRY_BELOW_AUTO_REMOVE_MIN_PRICE — the management stage keeps
  // `state.config.management` in sync, so the gate reads the live symbols and
  // minimum price from state. Both checks also block forced entries.
  const symbol = autoRemove.symbol.normalize(decision.symbol);
  if (
    !state.config.management.symbols
      .map(autoRemove.symbol.normalize)
      .includes(symbol)
  ) {
    return false;
  }
  if (
    autoRemove.price.isBelowMinimum({
      minimumPrice: state.config.runtime.autoRemoveSymbolMinPrice,
      price: state.markPriceMap[symbol]?.price,
    })
  ) {
    return false;
  }

  // BOTH:BLOCK_ENTRY_VPOINT_MIGHT_FORMED — when the latest vPoint's tracked
  // excursion reaches VOLATILITY_THRESHOLD, the detector's counter-sequence
  // is already active: a new opposite point is forming but not yet emitted,
  // so the signal this entry rests on is stale. Blocks forced entries too.
  const latestPoint = state.vPointsMap[symbol]?.at(-1);
  if (
    latestPoint &&
    Math.max(latestPoint.maxUpPct ?? 0, latestPoint.maxDownPct ?? 0) >=
      VOLATILITY_THRESHOLD
  ) {
    return false;
  }

  if (decision.manual) return true;
  if (!state.config.runtime.autoEntryEnabled) return false;

  // BTEST:STOP_AUTO_ENTRY_BEFORE_END — environments bound the entry window
  // by seeding `state.entryCutoffTime`; unset means no cutoff.
  if (
    state.entryCutoffTime !== undefined &&
    state.currentTime >= state.entryCutoffTime
  ) {
    return false;
  }

  // BOTH:AUTO_ENTRY_DAILY_PNL_LIMIT_USDT — the engine accumulates closed
  // trade PnL on `state.dailyPnlUsdt`; production additionally refreshes it
  // from the combined live+sandbox persisted read each management cycle.
  return !runtimeDailyPnlLimit.guard.evaluatePnl({
    currentTimeMs: state.currentTime,
    pnlUsdt: resolveDailyPnlUsdt(state),
    thresholdUsdt: state.config.runtime.autoEntryDailyPnlLimitUSDT,
  }).reached;
}

/**
 * Entry-family gate, evaluated after the common checks in `guard/index.ts`
 * (account exists, runner toggle, exit branch, black-swan flag). Veto order
 * mirrors the original production `isActionAllowed`.
 */
function allows(
  decision: RuntimeEntryDecision,
  context: RuntimeContext,
  account: RuntimeAccountConfig,
): boolean {
  if (!account.enabled) return false;
  return capacity(decision, context, account) && policy(decision, context);
}

const entry = {
  allows,
  capacity,
  policy,
  dailyPnl: {
    recordClose: recordClosedPnlUsdt,
    resolve: resolveDailyPnlUsdt,
  },
} as const;

export default entry;
