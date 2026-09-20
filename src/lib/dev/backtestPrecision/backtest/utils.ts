import { detectVolatilityPoints } from "@/lib/dynamic";
import type { FetchKlinesFunction } from "@/lib/datasets/type";
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

/** Creates volatility history using only candles closed by the runtime start. */
export async function createInitialVPointsMap(
  symbols: string[],
  getKlines: FetchKlinesFunction,
  startTime: number,
  currentTime: number,
): Promise<RuntimeEngineState["vPointsMap"]> {
  const vPointsMap: RuntimeEngineState["vPointsMap"] = {};

  for (const symbol of symbols) {
    const klines = await getKlines({
      endTime: currentTime,
      exactDate: true,
      interval: "5m",
      startTime,
      symbol: `${symbol}_USDT`,
    });
    vPointsMap[symbol] = detectVolatilityPoints({
      klines: klines.filter((kline) => kline[6] <= currentTime),
      symbol,
    });
  }

  return vPointsMap;
}
