import type { RuntimeEngineState } from "@/lib/precision/types";
import type { BacktestPrecisionParams } from "../api/precision-api-types";

/** Creates the initial backtest balance for every enabled account. */
export function createInitialBalance(
  params: BacktestPrecisionParams,
): RuntimeEngineState["balance"] {
  const balance: RuntimeEngineState["balance"] = {};

  for (const account of params.config.accounts) {
    if (!account.enabled) continue;

    const initialBalance = Math.max(
      0,
      Number(account.sandbox.initialBalanceUSDT) || 0,
    );

    balance[account.slug] = {
      available: initialBalance,
      locked: 0,
      reserved: 0,
      safeHaven: 0,
      spendable: initialBalance,
      startingBalance: initialBalance,
      total: initialBalance,
    };
  }

  return balance;
}
