import { detectVolatilityPoints } from "@/lib/dynamic";
import type { FetchKlinesFunction } from "@/lib/datasets/type";
import type { RuntimeEngineState } from "@/lib/precision/types";
import type { BacktestPrecisionParams } from "../api/precision-api-types";

/** Logs logical backtest progress once per UTC day and once at completion. */
export function createProgressLogger(
  startTime: number,
  endTime: number,
  getTradeHistoryLength: () => number = () => 0,
): (currentTime: number) => void {
  let completed = false;
  let lastDay = "";
  const duration = Math.max(1, endTime - startTime);

  return (currentTime) => {
    const boundedTime = Math.min(Math.max(currentTime, startTime), endTime);
    const day = new Date(boundedTime).toISOString().slice(0, 10);
    const finished = boundedTime >= endTime;

    if (day === lastDay && (!finished || completed)) return;

    const progress = finished
      ? 100
      : ((boundedTime - startTime) / duration) * 100;
    console.log(
      `[Precision Backtest] ${day} | ${progress.toFixed(1)}% | ` +
        `tradeHistory:${getTradeHistoryLength()}`,
    );

    lastDay = day;
    completed = finished;
  };
}

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
