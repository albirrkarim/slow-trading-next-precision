import { getMarketCapUSDMapForSymbols } from "@/lib/exchange/market-cap";
import { resolveMarketTypeForTradingMode } from "@/lib/exchange/utils";
import type { RuntimeContext } from "@/lib/precision/types";
import { systemLog } from "@/lib/system/logging";
import managementAction from "@/lib/system/notification/management";
import { runtimeNormalize } from "@/lib/system/runtime";
import { runtimeLogs, runtimeStorage } from "@/lib/system/storage";
import autoRemove from "@/lib/system/trading/auto-remove";
import type {
  ExchangeType,
  FetchKlines,
  MarketType,
  VolatilityPoint,
} from "@/lib/system/types";

const PRICE_FETCH_CONCURRENCY = 4;
/** 5m kline window covering the latest closed candle plus one spare. */
const PRICE_LOOKBACK_MINUTES = 10;

/** Normalized auto-removal thresholds read from the persisted runtime config. */
interface CoinManagementThresholds {
  absLevel: number;
  minMarketCapUSD: number;
  minPrice: number;
  minVPointPct: number;
}

/** Market/volatility data gathered outside the serialized stage queue. */
interface CoinManagementEvaluation {
  latestMarketCapBySymbol: Record<string, number>;
  latestPriceBySymbol: Record<string, number>;
  volatilityPointsBySymbol: Record<string, VolatilityPoint[]>;
}

interface CoinManagementAction {
  action: "remove";
  reason: string;
  source: string;
  symbol: string;
  t: number;
}

export interface CoinManagementRunResult {
  removedSymbols: string[];
  skipped: boolean;
}

function readThresholds(runtime: {
  autoRemoveSymbolAbsLevel?: unknown;
  autoRemoveSymbolMinMarketCapUSD?: unknown;
  autoRemoveSymbolMinPrice?: unknown;
  autoRemoveSymbolMinVPointPct?: unknown;
}): CoinManagementThresholds {
  return {
    absLevel: runtimeNormalize.values.autoRemoveAbsLevel(
      runtime.autoRemoveSymbolAbsLevel,
    ),
    minMarketCapUSD: runtimeNormalize.values.autoRemoveFloor(
      runtime.autoRemoveSymbolMinMarketCapUSD,
    ),
    minPrice: runtimeNormalize.values.autoRemoveFloor(
      runtime.autoRemoveSymbolMinPrice,
    ),
    minVPointPct: runtimeNormalize.values.autoRemoveVPointPct(
      runtime.autoRemoveSymbolMinVPointPct,
    ),
  };
}

function isDisabled(thresholds: CoinManagementThresholds): boolean {
  return (
    thresholds.absLevel <= 0 &&
    thresholds.minMarketCapUSD <= 0 &&
    thresholds.minPrice <= 0 &&
    thresholds.minVPointPct <= 0
  );
}

/**
 * Resolves the latest closed 5-minute kline close for each symbol. Failed or
 * missing data simply leaves the symbol out — an unknown price never proves
 * a coin is below the configured minimum.
 */
async function buildLatestPriceBySymbol(params: {
  getKlines: FetchKlines;
  marketType: MarketType;
  now: number;
  symbols: string[];
}): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const queue = [...params.symbols];
  let cursor = 0;

  await Promise.all(
    Array.from(
      { length: Math.min(PRICE_FETCH_CONCURRENCY, queue.length) },
      async () => {
        while (cursor < queue.length) {
          const symbol = queue[cursor++];
          try {
            const klines = await params.getKlines({
              endTime: params.now,
              interval: "5m",
              marketType: params.marketType,
              minutes: PRICE_LOOKBACK_MINUTES,
              symbol: `${symbol}_USDT`,
            });
            const closed = klines.findLast(
              (kline) => kline[6] <= params.now,
            );
            const price = Number(closed?.[4]);
            if (Number.isFinite(price) && price > 0) {
              out[symbol] = price;
            }
          } catch {
            // A failed price read must not remove or block the coin.
          }
        }
      },
    ),
  );

  return out;
}

/**
 * Gathers every data source the removal rules need. All reads run outside
 * the serialized trading-stage queue so slow market data never delays entry
 * capture; the commit re-checks candidates against the freshest config.
 */
async function evaluate(params: {
  exchangeType: ExchangeType;
  getKlines: FetchKlines;
  marketType: MarketType;
  now: number;
  symbols: string[];
  thresholds: CoinManagementThresholds;
}): Promise<CoinManagementEvaluation> {
  const { thresholds } = params;
  const [
    latestPriceBySymbol,
    latestMarketCapBySymbol,
    volatilityPointsBySymbol,
  ] = await Promise.all([
    thresholds.minPrice > 0
      ? buildLatestPriceBySymbol({
          getKlines: params.getKlines,
          marketType: params.marketType,
          now: params.now,
          symbols: params.symbols,
        })
      : Promise.resolve({}),
    thresholds.minMarketCapUSD > 0
      ? getMarketCapUSDMapForSymbols(params.symbols)
      : Promise.resolve({}),
    thresholds.absLevel > 0 || thresholds.minVPointPct > 0
      ? Object.fromEntries(
          await Promise.all(
            params.symbols.map(
              async (symbol) =>
                [
                  symbol,
                  await runtimeStorage.vpoints
                    .read({
                      exchangeType: params.exchangeType,
                      symbol,
                    })
                    .catch(() => [] as VolatilityPoint[]),
                ] as const,
            ),
          ),
        )
      : Promise.resolve({}),
  ]);

  return {
    latestMarketCapBySymbol,
    latestPriceBySymbol,
    volatilityPointsBySymbol,
  };
}

/** Builds the management-log/notification actions for the removed symbols. */
function buildActions(params: {
  evaluation: CoinManagementEvaluation;
  mode: string;
  removedByAbsLevel: string[];
  removedByMarketCap: string[];
  removedByMinPrice: string[];
  removedByVPointPct: string[];
  removedSymbols: string[];
  thresholds: CoinManagementThresholds;
  t: number;
}): CoinManagementAction[] {
  const removedByAbsLevelSet = new Set(params.removedByAbsLevel);
  const removedByMarketCapSet = new Set(params.removedByMarketCap);
  const removedByMinPriceSet = new Set(params.removedByMinPrice);
  const removedByVPointPctSet = new Set(params.removedByVPointPct);

  return params.removedSymbols.map((symbol) => {
    const reasons: string[] = [];
    const sources: string[] = [];

    if (removedByAbsLevelSet.has(symbol)) {
      const latestPoint =
        params.evaluation.volatilityPointsBySymbol[symbol]?.at(-1);
      reasons.push(
        `Latest vPoint absolute level ${Math.abs(Number(latestPoint?.lvl ?? 0))} ` +
          `reached threshold ${params.thresholds.absLevel}.`,
      );
      sources.push("auto-remove-abs-level");
    }
    if (removedByMinPriceSet.has(symbol)) {
      reasons.push(
        `Latest price ${params.evaluation.latestPriceBySymbol[symbol]} USDT ` +
          `fell below minimum ${params.thresholds.minPrice} USDT.`,
      );
      sources.push("auto-remove-min-price");
    }
    if (removedByMarketCapSet.has(symbol)) {
      reasons.push(
        `Latest market cap ${params.evaluation.latestMarketCapBySymbol[symbol]} USD ` +
          `fell below minimum ${params.thresholds.minMarketCapUSD} USD.`,
      );
      sources.push("auto-remove-market-cap");
    }
    if (removedByVPointPctSet.has(symbol)) {
      const highestPoint = autoRemove.vPoint.findHighestPct(
        params.evaluation.volatilityPointsBySymbol[symbol] ?? [],
      );
      reasons.push(
        `Stored vPoint ${highestPoint?.id ?? "unknown"} movement ` +
          `${highestPoint?.pct ?? "unknown"}% reached threshold ` +
          `${params.thresholds.minVPointPct}%.`,
      );
      sources.push("auto-remove-vpoint-pct");
    }

    return {
      action: "remove" as const,
      reason: reasons.join(" "),
      source:
        `slow-trading.${params.mode}-cycle.coin-management:` +
        sources.join("+"),
      symbol,
      t: params.t,
    };
  });
}

/**
 * Runs one coin auto-removal pass: evaluates market/volatility data outside
 * the serialized trading-stage queue, then commits the symbol-list change in
 * a short exclusive section that reloads the latest catalog, re-evaluates
 * candidates with the freshest thresholds and symbol list, syncs the running
 * engine's in-memory config, and emits management logs plus notifications.
 *
 * Removal never touches open positions — it only retires the coin from the
 * configured universe for new entries.
 */
async function run(params: {
  getKlines: FetchKlines;
  runExclusive: <T>(
    task: (context: RuntimeContext) => Promise<T>,
  ) => Promise<T>;
  now?: () => number;
}): Promise<CoinManagementRunResult> {
  const now = params.now ?? Date.now;
  const catalog = await runtimeStorage.catalog.load();
  const runtime = catalog.config.runtime;
  if (!runtime.runnerEnabled) {
    return { removedSymbols: [], skipped: true };
  }

  const thresholds = readThresholds(runtime);
  const symbols = catalog.config.management.symbols
    .map(autoRemove.symbol.normalize)
    .filter(Boolean);
  if (isDisabled(thresholds) || symbols.length === 0) {
    return { removedSymbols: [], skipped: true };
  }

  const evaluation = await evaluate({
    exchangeType: catalog.config.management.exchangeType,
    getKlines: params.getKlines,
    marketType: resolveMarketTypeForTradingMode(
      catalog.config.management.tradingMode,
    ),
    now: now(),
    symbols,
    thresholds,
  });

  // PROD:AUTO_REMOVE_COMMIT — only this short section serializes with trading
  // mutations; it re-reads the catalog so stale snapshots never overwrite a
  // concurrent dashboard edit, and re-evaluates with the latest config.
  const committed = await params.runExclusive(async (context) => {
    const latest = await runtimeStorage.catalog.load();
    const latestRuntime = latest.config.runtime;
    const latestThresholds = readThresholds(latestRuntime);
    const latestSymbols = latest.config.management.symbols;

    // PROD:AUTO_REMOVE_COIN_ABOVE_SOME_ABS_LEVEL
    const removedByAbsLevel = autoRemove.find.byAbsLevel({
      configuredSymbols: latestSymbols,
      thresholdAbsLevel: latestThresholds.absLevel,
      volatilityPointsBySymbol: evaluation.volatilityPointsBySymbol,
    });
    // PROD:AUTO_REMOVE_COIN_BELOW_MIN_PRICE
    const removedByMinPrice = autoRemove.find.byMinPrice({
      configuredSymbols: latestSymbols,
      latestPriceBySymbol: evaluation.latestPriceBySymbol,
      minimumPrice: latestThresholds.minPrice,
    });
    // PROD:AUTO_REMOVE_COIN_BELOW_MIN_MARKET_CAP
    const removedByMarketCap = autoRemove.find.byMarketCap({
      configuredSymbols: latestSymbols,
      marketCapUSDBySymbol: evaluation.latestMarketCapBySymbol,
      minimumMarketCapUSD: latestThresholds.minMarketCapUSD,
    });
    // PROD:AUTO_REMOVE_COIN_BY_VPOINT_PCT
    const removedByVPointPct = autoRemove.find.byVPointPct({
      configuredSymbols: latestSymbols,
      minimumVPointPct: latestThresholds.minVPointPct,
      volatilityPointsBySymbol: evaluation.volatilityPointsBySymbol,
    });
    const removedSymbols = Array.from(
      new Set([
        ...removedByAbsLevel,
        ...removedByMinPrice,
        ...removedByMarketCap,
        ...removedByVPointPct,
      ]),
    );

    // Matches the catalog's sorted uniqueSymbols normalization so the
    // in-memory list mirrors what persistence writes.
    const nextSymbols = autoRemove.remove
      .fromConfig(latestSymbols, removedSymbols)
      .sort((a, b) => a.localeCompare(b));
    if (removedSymbols.length > 0) {
      await runtimeStorage.catalog.update({ symbols: nextSymbols });
      // Sync the running engine's config so the same cycle's entry capture
      // and market updates stop treating the coin as configured.
      context.state.config.management.symbols = nextSymbols;
    }
    context.state.config.runtime.autoRemoveSymbolAbsLevel =
      latestThresholds.absLevel;
    context.state.config.runtime.autoRemoveSymbolMinMarketCapUSD =
      latestThresholds.minMarketCapUSD;
    context.state.config.runtime.autoRemoveSymbolMinPrice =
      latestThresholds.minPrice;
    context.state.config.runtime.autoRemoveSymbolMinVPointPct =
      latestThresholds.minVPointPct;

    return {
      actions: buildActions({
        evaluation,
        mode: context.state.mode,
        removedByAbsLevel,
        removedByMarketCap,
        removedByMinPrice,
        removedByVPointPct,
        removedSymbols,
        thresholds: latestThresholds,
        t: context.state.currentTime,
      }),
      notification: latestRuntime.notification,
      removedSymbols,
    };
  });

  if (committed.removedSymbols.length > 0) {
    systemLog.info("[slow-trading] auto removed configured symbols", {
      removedSymbols: committed.removedSymbols,
    });

    await Promise.all(
      committed.actions.map((action) =>
        runtimeLogs.appendManagement({
          action: action.action,
          reason: action.reason,
          source: action.source,
          symbol: action.symbol,
          timestamp: action.t,
        }),
      ),
    ).catch((error) => {
      systemLog.error(
        "[slow-trading] failed to persist management-action log",
        error,
      );
    });

    if (committed.notification) {
      await managementAction
        .notify({
          actions: committed.actions,
          notification: committed.notification,
        })
        .catch((error) => {
          systemLog.error(
            "[slow-trading] failed to send management-action notification",
            error,
          );
        });
    }
  }

  return {
    removedSymbols: committed.removedSymbols,
    skipped: false,
  };
}

const coinManagement = { run } as const;

export default coinManagement;
export { coinManagement };
