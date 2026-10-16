import { getExchange } from "@/lib/exchange";
import { runWithExchangeAccount } from "@/lib/exchange/account-context";
import binanceRequestCoordinator from "@/lib/exchange/platform/binance/request-coordinator";
import { TradingMode, type UnifiedPosition } from "@/lib/exchange/types";
import { systemLog } from "@/lib/system/logging";
import runtimeAccountConfig from "@/lib/system/runtime/account-config";
import type { RuntimeAccountConfig, RuntimeConfig } from "@/lib/system/runtime/types";
import runtimeAccountState from "@/lib/system/storage/account-state";
import runtimeStorage from "@/lib/system/storage/runtime";
import type { Position } from "@/lib/system/trading/types";

import singleton from "./singleton";

// PROD:SYNC_ENTRY_POSITION_FROM_EXCHANGE — the exchange is the source of truth
// for live positions. A live position kept in local storage that the exchange
// no longer holds was closed outside Precision ([CLOSED_ON_EXCHANGE]); the
// operator can remove it so its margin stops counting as locked balance.

/** One stored live position the exchange no longer reports as open. */
export interface StaleLivePosition {
  direction: Position["direction"];
  /** Stable identity: symbol, direction and open time. */
  key: string;
  marginUsdt: number;
  openedAt: number;
  quantity: number;
  reservedUsdt: number;
  symbol: string;
}

export interface StaleLiveScan {
  account: string;
  checkedAt: number;
  /** Open positions the exchange reported for this account. */
  exchangeOpen: number;
  stale: StaleLivePosition[];
  /** Open live positions kept in local storage. */
  storedOpen: number;
}

function normalizeSymbol(value: string | undefined): string {
  return String(value ?? "")
    .replace(/[-_/]/g, "")
    .trim()
    .toUpperCase();
}

/** Stable identity of a stored position: symbol, direction and open time. */
function positionKey(position: Position): string {
  return `${normalizeSymbol(position.symbol)}|${position.direction}|${position.opened.t}`;
}

/**
 * Stored open positions with no matching exchange position. A position is kept
 * whenever the exchange holds any non-zero position on the same symbol in the
 * same direction, or a one-way (NET) position on that symbol, so a real
 * position is never treated as stale.
 */
function findStale(stored: Position[], exchangeOpen: UnifiedPosition[]): Position[] {
  return stored.filter((position) => {
    if (position.closed) return false;
    const symbol = normalizeSymbol(position.symbol);
    return !exchangeOpen.some(
      (open) =>
        normalizeSymbol(open.symbol || open.originalSymbol) === symbol &&
        Number.isFinite(open.amount) &&
        open.amount > 0 &&
        (open.side === position.direction || open.side === "NET"),
    );
  });
}

function summarize(position: Position): StaleLivePosition {
  return {
    direction: position.direction,
    key: positionKey(position),
    marginUsdt: Math.max(0, position.exposure.marginUsdt),
    openedAt: position.opened.t,
    quantity: position.exposure.quantity,
    reservedUsdt: Math.max(0, position.strategy?.averaging?.reservedRemainingMarginUsdt ?? 0),
    symbol: position.symbol,
  };
}

function toExchangeTradingMode(tradingMode: string): TradingMode {
  switch (tradingMode) {
    case "futures":
      return TradingMode.FUTURES;
    case "margin_cross":
      return TradingMode.MARGIN_CROSS;
    case "margin_isolated":
      return TradingMode.MARGIN_ISOLATED;
    default:
      return TradingMode.SPOT;
  }
}

/** Every open position the exchange reports for the account; throws when the exchange cannot be read. */
async function readExchangePositions(account: RuntimeAccountConfig, config: RuntimeConfig): Promise<UnifiedPosition[]> {
  const effective = runtimeAccountConfig.effective(config.management, account);
  if (effective.exchangeType === "binance" && binanceRequestCoordinator.cooldown.get()) {
    throw new Error("Binance is cooling down after a rate limit; try again in a minute.");
  }

  return runWithExchangeAccount(runtimeAccountState.toExchangeAccount(account), () =>
    getExchange(effective.exchangeType, {
      defaultTradingMode: toExchangeTradingMode(effective.tradingMode),
    }).getPositions(),
  );
}

async function resolveAccount(accountSlug: string) {
  const catalog = await runtimeStorage.catalog.ensure();
  const account = catalog.config.accounts.find((item) => item.slug === accountSlug);
  if (!account) throw new Error(`Account ${accountSlug} is not configured.`);

  return { account, catalog };
}

/** Compares the account's stored live positions with the exchange's open positions. */
async function scan(accountSlug: string): Promise<StaleLiveScan> {
  const { account, catalog } = await resolveAccount(accountSlug);
  const exchangeOpen = await readExchangePositions(account, catalog.config);
  const memory = await runtimeStorage.account.load({ accountSlug: account.slug, mode: "live" });
  const storedOpen = memory.positions.filter((position) => !position.closed);

  return {
    account: account.slug,
    checkedAt: Date.now(),
    exchangeOpen: exchangeOpen.length,
    stale: findStale(storedOpen, exchangeOpen).map(summarize),
    storedOpen: storedOpen.length,
  };
}

/**
 * Removes the requested stale live positions after re-checking the exchange.
 * Only positions that are still stale now and were requested by key are removed.
 * No history row is written: the real exit price and PnL are unknown, and an
 * invented close would distort realized PnL.
 */
async function clean(accountSlug: string, keys: string[]): Promise<StaleLivePosition[]> {
  const { account, catalog } = await resolveAccount(accountSlug);
  const exchangeOpen = await readExchangePositions(account, catalog.config);
  const wanted = new Set(keys);
  const pick = (positions: Position[]) =>
    findStale(positions, exchangeOpen).filter((position) => wanted.has(positionKey(position)));

  // The engine fixes its mode when it starts, so the saved setting can say live
  // while a running engine still holds sandbox state. Decide inside the
  // serialized manual pass from the engine's own mode.
  const removed = await singleton.get().runManual(async (context) => {
    if (context.state.mode === "live") {
      // The live engine holds open positions in memory and rewrites storage on
      // every pass, so they are removed from memory and then persisted.
      const stale = pick(context.state.openPositions.filter((position) => position.account === account.slug));
      if (stale.length === 0) return [];
      const balance = context.helper.getAccountBalance(account.slug);
      for (const position of stale) {
        const index = context.state.openPositions.indexOf(position);
        if (index >= 0) context.state.openPositions.splice(index, 1);
        balance.locked = Math.max(0, balance.locked - Math.max(0, position.exposure.marginUsdt));
        balance.reserved = Math.max(
          0,
          balance.reserved - Math.max(0, position.strategy?.averaging?.reservedRemainingMarginUsdt ?? 0),
        );
      }
      balance.spendable = Math.max(0, balance.available - balance.reserved - balance.safeHaven);
      balance.total = balance.available + balance.locked;
      await context.adapter.onStateChange?.(context, account.slug);
      return stale;
    }

    // A sandbox engine never writes live files, so live storage is authoritative.
    const memory = await runtimeStorage.account.load({ accountSlug: account.slug, mode: "live" });
    const stale = pick(memory.positions);
    if (stale.length === 0) return [];
    const releasedReserve = stale.reduce(
      (sum, position) => sum + Math.max(0, position.strategy?.averaging?.reservedRemainingMarginUsdt ?? 0),
      0,
    );
    const reserved = Number(memory.balance.reservedQuoteAsset ?? 0);
    await runtimeStorage.account.save({
      accountSlug: account.slug,
      mode: "live",
      state: {
        balance: { ...memory.balance, reservedQuoteAsset: Math.max(0, reserved - releasedReserve) },
        positions: memory.positions.filter((position) => !stale.includes(position)),
      },
    });
    return stale;
  });

  for (const position of removed) {
    systemLog.warn(
      `[CLOSED_ON_EXCHANGE] removed stale live position ${account.slug}/${position.symbol} ${position.direction} ` +
        `opened ${new Date(position.opened.t).toISOString()} margin ${position.exposure.marginUsdt} USDT`,
    );
  }

  return removed.map(summarize);
}

const staleLivePositions = { clean, findStale, positionKey, scan } as const;

export default staleLivePositions;
