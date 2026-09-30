import monitoring from "@/lib/precision/monitoring";
import type {
  RuntimeContext,
  RuntimeEngineAdapter,
  RuntimeStageRunPatch,
} from "@/lib/precision/types";
import type { Kline } from "@/lib/system/types";
import blackSwan, {
  type BlackSwanConfig,
  type BlackSwanState,
} from "@/lib/system/trading/black-swan";

const SENTINEL_LOOKBACK_MINUTES = 65;
const BREADTH_FETCH_CONCURRENCY = 4;

function normalizeSymbol(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/_USDT$/, "");
}

function getCandles(
  context: RuntimeContext,
  symbol: string,
  endTime: number,
): Promise<Kline[]> {
  return context.adapter.market.getKlines({
    endTime,
    interval: "1m",
    marketType:
      context.state.config.management.tradingMode === "futures"
        ? "FUTURES"
        : "SPOT",
    minutes: SENTINEL_LOOKBACK_MINUTES,
    symbol: `${normalizeSymbol(symbol)}_USDT`,
  });
}

function isBtcWarning(
  state: BlackSwanState,
  config: BlackSwanConfig,
): boolean {
  return (
    (state.evidence?.btc[5]?.pct ?? 0) <=
      -config.btcWarning.fiveMinuteDrawdownPct ||
    (state.evidence?.btc[15]?.pct ?? 0) <=
      -config.btcWarning.fifteenMinuteDrawdownPct
  );
}

async function getBreadthCandles(
  context: RuntimeContext,
  endTime: number,
): Promise<Record<string, Kline[]>> {
  const output: Record<string, Kline[]> = {};
  const queue = Array.from(
    new Set(
      context.state.config.management.symbols
        .map(normalizeSymbol)
        .filter(Boolean),
    ),
  ).filter((symbol) => symbol !== "BTC");
  let cursor = 0;

  await Promise.all(
    Array.from(
      { length: Math.min(BREADTH_FETCH_CONCURRENCY, queue.length) },
      async () => {
        while (cursor < queue.length) {
          const symbol = queue[cursor++];
          try {
            output[symbol] = await getCandles(context, symbol, endTime);
          } catch {
            continue;
          }
        }
      },
    ),
  );

  return output;
}

/**
 * Detector state lives on the engine state (`context.state.blackSwanStatus`)
 * rather than a hook closure, so a recreated hook resumes the same cooldown
 * and status. `options.onState` is invoked after each evaluation is written
 * — recording only; it never influences detection or trading.
 */
function create(options?: {
  onState?: (next: BlackSwanState) => void;
}): NonNullable<RuntimeEngineAdapter["onRiskSentinel"]> {
  return async (context): Promise<RuntimeStageRunPatch> => {
    const now = context.state.currentTime;
    const config = blackSwan.config.normalize(
      context.state.config.management.blackSwan,
    );
    const previous = context.state.blackSwanStatus ?? blackSwan.state.create();

    let btcCandles: Kline[] = [];
    if (config.enabled) {
      try {
        btcCandles = await getCandles(context, "BTC", now);
      } catch {
        btcCandles = [];
      }
    }

    const firstPass = blackSwan.detector.evaluate({
      btcCandles,
      config,
      currentTimeMs: now,
      mode: "sandbox",
      previous,
    });
    const breadthCandlesBySymbol =
      config.enabled && isBtcWarning(firstPass, config)
        ? await getBreadthCandles(context, now)
        : undefined;

    const next = blackSwan.detector.evaluate({
      breadthCandlesBySymbol,
      btcCandles,
      config,
      currentTimeMs: now,
      mode: "sandbox",
      previous,
    });
    context.state.blackSwanStatus = next;
    context.state.blackSwanProtective = blackSwan.state.isProtective(next);
    options?.onState?.(next);

    const emergencyExits: string[] = [];
    if (next.status === "CRISIS" && config.exitPolicy !== "FREEZE_ONLY") {
      const selected = context.state.openPositions.filter(
        (position) =>
          !position.closed &&
          blackSwan.emergency.shouldClose({
            direction: position.direction,
            exitPolicy: config.exitPolicy,
            tradingMode: String(
              context.state.config.management.tradingMode,
            ),
          }),
      );
      if (selected.length > 0) {
        await context.helper.market.updateMarkPrice("1m");
      }
      for (const position of selected) {
        position.control = {
          ...position.control,
          forceExit: { reason: `BLACK_SWAN:${next.reason}` },
        };
        await monitoring.position.monitor(context, position);
        if (!context.state.openPositions.includes(position)) {
          emergencyExits.push(normalizeSymbol(position.symbol));
        }
      }
    }

    return {
      reports: emergencyExits.length,
      summary:
        `backtest risk sentinel ${next.status} (${next.reason})` +
        ` | emergency exits ${emergencyExits.length}`,
      symbols: config.enabled
        ? 1 + Object.keys(breadthCandlesBySymbol ?? {}).length
        : 0,
    };
  };
}

const backtestBlackSwan = {
  riskSentinel: { create },
} as const;

export default backtestBlackSwan;
