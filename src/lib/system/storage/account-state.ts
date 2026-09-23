import type { ExchangeAccount } from "@/lib/exchange/account-context";
import type { RuntimeAccountConfig } from "../runtime/types";
import type { BalanceSummary, Position } from "../trading/types";
import type {
  RuntimeAccountModeState,
  RuntimeBalanceMemory,
} from "./runtime";

function finite(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Derives the runtime balance summary from persisted memory and open positions. */
function buildBalance(params: {
  balance: RuntimeBalanceMemory;
  positions: Position[];
}): BalanceSummary {
  const memory = params.balance;
  const safeHaven = Math.max(0, finite(memory.safeHaven));
  const quoteAsset = Math.max(0, finite(memory.quoteAsset));
  const available = quoteAsset + safeHaven;
  const reserved = Math.max(0, finite(memory.reservedQuoteAsset));
  const locked = params.positions
    .filter((position) => !position.closed)
    .reduce(
      (total, position) =>
        total + Math.max(0, finite(position.exposure.marginUsdt)),
      0,
    );

  return {
    available,
    locked,
    reserved,
    safeHaven,
    spendable: Math.max(0, available - reserved - safeHaven),
    startingBalance: Math.max(0, finite(memory.startingBalanceUSDT)),
    total: available + locked,
  };
}

/** Seeds sandbox balance memory when the account has never traded. */
function ensureSandboxBalance(
  state: RuntimeAccountModeState,
  initialBalanceUSDT: number,
): void {
  const hasHistory = state.positions.length > 0;
  if (!hasHistory && finite(state.balance.startingBalanceUSDT) <= 0) {
    state.balance.startingBalanceUSDT = initialBalanceUSDT;
    state.balance.quoteAsset = initialBalanceUSDT;
  }
}

/**
 * Applies an authoritative exchange quote balance to live memory. The stored
 * quote asset excludes the safe-haven amount, matching the persisted shape.
 */
function applyLiveQuoteAsset(
  memory: RuntimeBalanceMemory,
  quoteAsset: number,
): number {
  const safeHaven = finite(memory.safeHaven);
  const available = quoteAsset - safeHaven;
  memory.quoteAsset = available;
  if (!finite(memory.startingBalanceUSDT)) {
    memory.startingBalanceUSDT = available;
  }
  return available;
}

/** Writes the mutable runtime balance summary back into persisted memory. */
function syncBalance(
  memory: RuntimeBalanceMemory,
  summary: BalanceSummary,
): void {
  const safeHaven = Math.max(0, finite(memory.safeHaven));
  memory.quoteAsset = Math.max(0, summary.available - safeHaven);
  memory.reservedQuoteAsset = Math.max(0, summary.reserved);
}

/** Maps a runtime account config to the exchange account-context shape. */
function toExchangeAccount(account: RuntimeAccountConfig): ExchangeAccount {
  return {
    slug: account.slug,
    type: account.type ?? "binance",
    name: account.name ?? account.slug,
    description: account.description ?? "",
    credentials: {
      apiKey: account.credentials?.apiKey ?? "",
      apiSecret: account.credentials?.apiSecret ?? "",
      passphrase: account.credentials?.passphrase,
    },
    createdAt: account.createdAt ?? 0,
    updatedAt: account.updatedAt ?? 0,
  };
}

/** Grouped account-state helpers over the persisted account/mode shape. */
const runtimeAccountState = {
  applyLiveQuoteAsset,
  buildBalance,
  ensureSandboxBalance,
  syncBalance,
  toExchangeAccount,
} as const;

export default runtimeAccountState;
export { runtimeAccountState };
