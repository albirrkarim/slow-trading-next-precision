import type { RuntimeEngineState } from "@/lib/precision/types";
import {
  resolveVolatilityRetracePct,
  resolveVolatilityThreshold,
  type VolatilityThresholdOverride,
} from "@/lib/system/constants";
import type { FetchKlines } from "@/lib/system/types";
import vpoints from "@/lib/system/utils/vpoints";
import { DAY_MS, getDayStart } from "../../klines";
import type { BacktestPrecisionParams } from "../api/precision-api-types";
import type { BacktestBalanceSnapshot } from "./backtest-precision-types";

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
      `\n\n[Precision Backtest] ${day} | ${progress.toFixed(1)}% | ` +
        `tradeHistory:${getTradeHistoryLength()}\n\n`,
    );

    lastDay = day;
    completed = finished;
  };
}

/**
 * Logs kline-dataset preparation: one line per symbol start, then a progress
 * line each time the prepared-day count crosses a whole percent of the total
 * symbol-days, plus a per-symbol summary distinguishing cached days from days
 * that actually hit the network.
 */
export function createPrepareLogger(
  symbols: string[],
  startTime: number,
  endTime: number,
): {
  dayPrepared: (symbol: string, dayStart: number, downloaded: boolean) => void;
  symbolDone: (symbol: string) => void;
  symbolStart: (symbol: string, index: number) => void;
} {
  const daysPerSymbol = Math.max(
    1,
    Math.ceil((endTime - getDayStart(startTime)) / DAY_MS),
  );
  const totalDays = Math.max(1, symbols.length * daysPerSymbol);
  let preparedDays = 0;
  let lastLoggedPercent = -1;
  let symbolDays = 0;
  let fetchedDays: string[] = [];

  return {
    dayPrepared(symbol, dayStart, downloaded) {
      preparedDays += 1;
      symbolDays += 1;
      if (downloaded) {
        fetchedDays.push(new Date(dayStart).toISOString().slice(0, 10));
      }
      const percent = Math.min(100, (preparedDays / totalDays) * 100);
      if (preparedDays < totalDays && percent - lastLoggedPercent < 1) {
        return;
      }
      lastLoggedPercent = percent;
      const day = new Date(dayStart).toISOString().slice(0, 10);
      console.log(
        `[Precision Backtest] Prepare klines | ${percent.toFixed(1)}% | ` +
          `${symbol} ${day}${downloaded ? " (fetch)" : ""}`,
      );
    },
    symbolDone(symbol) {
      const cached = symbolDays - fetchedDays.length;
      const detail =
        fetchedDays.length > 0 && fetchedDays.length <= 10
          ? ` (${fetchedDays.join(", ")})`
          : "";
      console.log(
        `[Precision Backtest] Prepare klines | ${symbol} done | ` +
          `${cached} cached | ${fetchedDays.length} fetched${detail}`,
      );
      symbolDays = 0;
      fetchedDays = [];
    },
    symbolStart(symbol, index) {
      console.log(
        `\n[Precision Backtest] Prepare klines | ${symbol} ` +
          `(${index + 1}/${symbols.length})`,
      );
    },
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

/** Copies each account's balance summary into a per-account snapshot map. */
export function snapshotAccountBalances(
  balance: RuntimeEngineState["balance"],
  t: number,
): Record<string, BacktestBalanceSnapshot> {
  return Object.fromEntries(
    Object.entries(balance).map(([slug, summary]) => [
      slug,
      { t, ...summary },
    ]),
  );
}

/**
 * Creates volatility history using only candles closed by the runtime start.
 * `management` carries the optional detector overrides so a backtest's
 * warm-up stream is detected under the same params as its live window.
 */
export async function createInitialVPointsMap(
  symbols: string[],
  getKlines: FetchKlines,
  startTime: number,
  currentTime: number,
  management?: VolatilityThresholdOverride | null,
): Promise<RuntimeEngineState["vPointsMap"]> {
  const vPointsMap: RuntimeEngineState["vPointsMap"] = {};
  const moveThreshold = resolveVolatilityThreshold(management);
  const retracePercent = resolveVolatilityRetracePct(management);

  for (const symbol of symbols) {
    const klines = await getKlines({
      endTime: currentTime,
      exactDate: true,
      interval: "5m",
      startTime,
      symbol: `${symbol}_USDT`,
    });
    vPointsMap[symbol] = vpoints.detectVPoints({
      klines: klines.filter((kline) => kline[6] <= currentTime),
      moveThreshold,
      retracePercent,
      symbol,
    });
  }

  return vPointsMap;
}
