import { getExchange } from "@/lib/exchange";
import { runWithExchangeAccount } from "@/lib/exchange/account-context";
import binanceRequestCoordinator, {
  BinanceCooldownError,
} from "@/lib/exchange/platform/binance/request-coordinator";
import { TradingMode } from "@/lib/exchange/types";
import { resolveMarketTypeForTradingMode } from "@/lib/exchange/utils";

import { VOLATILITY_THRESHOLD } from "../constants";
import { systemLog } from "../logging";
import runtimeAccountConfig from "../runtime/account-config";
import type { RuntimeStageRunStatsMap } from "../runtime/stages";
import type {
  RuntimeAccountConfig,
  RuntimeConfig,
  RuntimeDashboardRuntimeConfig,
  RuntimeMode,
} from "../runtime/types";
import runtimeAccountState from "../storage/account-state";
import runtimeBinanceHealth from "../storage/binance-health";
import runtimeInstanceIp from "../storage/instance-ip";
import runtimeLogs from "../storage/logs";
import jsonFile from "../storage/json-file";
import storageFiles from "../storage/files";
import runtimeStorage from "../storage/runtime";
import type {
  RuntimeAccountModeState,
  RuntimeSystemStatus,
} from "../storage/runtime";
import blackSwan from "../trading/black-swan";
import reporting from "../trading/reporting";
import type { RuntimeHistoryPosition } from "../trading/types";
import type {
  RuntimeDashboardAccountSummary,
  RuntimeDashboardBalances,
  RuntimeDashboardRealtimeOptions,
  RuntimeDashboardState,
} from "./types";

function clone<T>(value: T): T {
  return structuredClone(value);
}

/** Maps the persisted trading-mode union to the exchange enum value. */
function toExchangeTradingMode(
  tradingMode: RuntimeConfig["management"]["tradingMode"] | string,
): TradingMode {
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

/** Loaded per-account inputs consumed by the pure dashboard projection. */
interface RuntimeDashboardAccountSource {
  account: RuntimeAccountConfig;
  history: RuntimeHistoryPosition[];
  modeState: RuntimeAccountModeState;
}

/**
 * Gets the latest close price for each position symbol through the account's
 * exchange credentials.
 */
async function getLatestPriceMap(params: {
  account: RuntimeAccountConfig;
  config: RuntimeConfig;
  positions: RuntimeHistoryPosition[];
}): Promise<Record<string, number>> {
  const effective = runtimeAccountConfig.effective(
    params.config.management,
    params.account,
  );
  const symbols = Array.from(
    new Set(
      params.positions
        .map((position) => position.symbol)
        .filter((symbol): symbol is string => Boolean(symbol)),
    ),
  );

  if (symbols.length === 0) {
    return {};
  }

  const entries = await runWithExchangeAccount(
    runtimeAccountState.toExchangeAccount(params.account),
    async () => {
      const tradingMode = toExchangeTradingMode(effective.tradingMode);
      const marketType = resolveMarketTypeForTradingMode(tradingMode);
      const exchange = getExchange(effective.exchangeType, {
        defaultTradingMode: tradingMode,
      });

      return Promise.all(
        symbols.map(async (symbol) => {
          try {
            const tradingSymbol = symbol.includes("_")
              ? symbol
              : `${symbol}_USDT`;
            const klines = await exchange.getKlines({
              symbol: tradingSymbol,
              interval: "1m",
              simpleTime: "5minute",
              limit: 5,
              marketType,
            });

            const latestPrice = Number.parseFloat(klines.at(-1)?.[4] ?? "");
            if (!Number.isFinite(latestPrice) || latestPrice <= 0) {
              return null;
            }

            return [symbol, latestPrice] as const;
          } catch (error) {
            if (binanceRequestCoordinator.error.isRateLimit(error)) {
              return null;
            }
            systemLog.warn(
              `[dashboard] failed to refresh floating pnl for ${symbol}`,
              error,
            );
            return null;
          }
        }),
      );
    },
  );

  return Object.fromEntries(
    entries.filter(
      (entry): entry is readonly [string, number] =>
        Array.isArray(entry) &&
        typeof entry[0] === "string" &&
        typeof entry[1] === "number",
    ),
  );
}

/** Gets the live quote balance through the account's exchange credentials. */
async function getLiveQuoteBalance(params: {
  account: RuntimeAccountConfig;
  config: RuntimeConfig;
}): Promise<number | null> {
  const effective = runtimeAccountConfig.effective(
    params.config.management,
    params.account,
  );

  if (
    effective.exchangeType === "binance" &&
    binanceRequestCoordinator.cooldown.get()
  ) {
    // PROD:BINANCE_GLOBAL_COOLDOWN
    return null;
  }

  return runWithExchangeAccount(
    runtimeAccountState.toExchangeAccount(params.account),
    async () => {
      const exchange = getExchange(effective.exchangeType, {
        defaultTradingMode: toExchangeTradingMode(effective.tradingMode),
      });

      try {
        const balance = await exchange.getBalance("USDT_USDT");
        if (!balance || !Number.isFinite(balance.quoteAsset)) {
          return null;
        }

        return balance.quoteAsset;
      } catch (error) {
        if (error instanceof BinanceCooldownError && !error.activated) {
          // PROD:BINANCE_GLOBAL_COOLDOWN
          return null;
        }

        // PROD:ERROR_LOG
        await runtimeLogs
          .appendError({
            source: "dashboard.live-balance",
            error,
            details: {
              account: params.account.slug,
              exchangeType: effective.exchangeType,
              tradingMode: effective.tradingMode,
            },
          })
          .catch((logError) => {
            systemLog.error(
              "[dashboard] failed to write live balance error log",
              logError,
            );
          });
        systemLog.warn(
          "[dashboard] failed to refresh live quote balance",
          error,
        );
        return null;
      }
    },
  );
}

/** Recomputes floating PnL on a cloned position at the latest mark price. */
function withFloatingPnl(
  position: RuntimeHistoryPosition,
  latestPrice: number | undefined,
  exchangeType: RuntimeConfig["management"]["exchangeType"],
): RuntimeHistoryPosition {
  const next = clone(position);
  const entryPrice = Number(next.exposure.averageEntryPrice) || 0;

  if (!(entryPrice > 0)) {
    return next;
  }

  const hasLatestPrice =
    typeof latestPrice === "number" &&
    Number.isFinite(latestPrice) &&
    latestPrice > 0;
  const safePrice = hasLatestPrice ? latestPrice : entryPrice;
  const storedMarkPrice = next.pnl.markPrice;
  reporting.pnl.applyFloatingMetrics(next, safePrice, exchangeType);
  if (!hasLatestPrice) {
    next.pnl.markPrice = storedMarkPrice;
  }

  return next;
}

/** Strips MCP token secrets before returning runtime data to the dashboard. */
function toDashboardRuntime(
  runtime: RuntimeConfig["runtime"],
): RuntimeDashboardRuntimeConfig {
  const runtimeClone = clone(runtime);
  return {
    ...runtimeClone,
    mcp: {
      tokens: (runtimeClone.mcp?.tokens ?? []).map(
        ({
          tokenHash: _tokenHash,
          tokenSecretEncrypted: _tokenSecretEncrypted,
          ...token
        }) => ({
          ...token,
          secretAvailable: Boolean(_tokenSecretEncrypted),
        }),
      ),
    },
  };
}

function toDashboardBalances(
  modeState: RuntimeAccountModeState,
): RuntimeDashboardBalances {
  const summary = runtimeAccountState.buildBalance({
    balance: modeState.balance,
    positions: modeState.positions,
  });

  return {
    availableQuoteAsset: summary.available,
    reservedQuoteAsset: summary.reserved,
    spendableQuoteAsset: summary.spendable,
    safeHaven: summary.safeHaven,
    lockedQuoteAsset: summary.locked,
    startingBalanceUSDT: summary.startingBalance,
  };
}

function toAccountSummary(params: {
  account: RuntimeAccountConfig;
  balances: RuntimeDashboardBalances;
  mode: RuntimeMode;
}): RuntimeDashboardAccountSummary {
  return {
    slug: params.account.slug,
    name: params.account.name ?? params.account.slug,
    enabled: params.account.enabled,
    activeMode: params.mode,
    balances: params.balances,
  };
}

/**
 * Projects one account's persisted state into the dashboard response model.
 * Pure — callers attach realtime fields.
 */
function buildState(params: {
  account: RuntimeAccountConfig;
  config: RuntimeConfig;
  mode: RuntimeMode;
  source: RuntimeDashboardAccountSource;
  status: RuntimeSystemStatus;
}): RuntimeDashboardState {
  const { account, config, mode, source, status } = params;
  const effective = runtimeAccountConfig.effective(
    config.management,
    account,
  );
  const history = reporting.positions.normalizeMany(
    source.history,
    effective.exchangeType,
  );
  const openPositions = reporting.positions.normalizeMany(
    source.modeState.positions
      .filter((position) => !position.closed)
      .map((position) => ({ ...position, mode })),
    effective.exchangeType,
  );
  const balances = toDashboardBalances(source.modeState);

  return {
    accountFilter: account.slug,
    accounts: clone(config.accounts),
    accountSummaries: [
      toAccountSummary({ account, balances, mode }),
    ],
    activeMode: mode,
    globalConfig: {
      volatilityThresholdPct: VOLATILITY_THRESHOLD,
    },
    config: effective,
    runtime: toDashboardRuntime(config.runtime),
    blackSwan: clone(status.blackSwan ?? blackSwan.state.create()),
    binanceHealth: {
      current: binanceRequestCoordinator.cooldown.get(),
      logs: [],
    },
    balances,
    history,
    openPositions,
    stats: {
      closedTrades: history.length,
      openPositions: openPositions.length,
      lastRunAt: status.lastRunAt,
      lastRunDurationMs: status.lastRunDurationMs,
      lastRunPerformance: status.lastRunPerformance,
      lastRunSummary: status.lastRunSummary,
      stageRuns: clone(status.stageRuns ?? {}),
      safeHavenLastScheduledAt: Number(
        source.modeState.balance.lastSafeHavenRequest ?? 0,
      ) || undefined,
    },
  };
}

/** Loads one account's persisted dashboard inputs for the active mode. */
async function loadAccountSource(params: {
  account: RuntimeAccountConfig;
  mode: RuntimeMode;
}): Promise<RuntimeDashboardAccountSource> {
  const [modeState, history] = await Promise.all([
    runtimeStorage.account.load({
      accountSlug: params.account.slug,
      mode: params.mode,
    }),
    runtimeStorage.history.readAll(params.mode, {
      account: params.account.slug,
    }),
  ]);

  return {
    account: params.account,
    history,
    modeState,
  };
}

/** Applies the live-balance and floating-PnL realtime passes to a snapshot. */
async function applyRealtime(params: {
  account: RuntimeAccountConfig;
  config: RuntimeConfig;
  options?: RuntimeDashboardRealtimeOptions;
  state: RuntimeDashboardState;
}): Promise<RuntimeDashboardState> {
  const { account, config, options } = params;
  let snapshot = params.state;

  if (snapshot.activeMode === "live" && options?.refreshLiveBalance !== false) {
    const liveQuoteBalance = await getLiveQuoteBalance({ account, config });
    if (liveQuoteBalance != null) {
      const safeHaven = snapshot.balances.safeHaven;
      const reservedQuoteAsset = snapshot.balances.reservedQuoteAsset;
      const spendableQuoteAsset = Math.max(
        0,
        liveQuoteBalance - reservedQuoteAsset - safeHaven,
      );
      snapshot = {
        ...snapshot,
        accountSummaries: snapshot.accountSummaries.map((summary) =>
          summary.slug === account.slug
            ? {
                ...summary,
                balances: {
                  ...summary.balances,
                  availableQuoteAsset: liveQuoteBalance,
                  spendableQuoteAsset,
                },
              }
            : summary,
        ),
        balances: {
          ...snapshot.balances,
          availableQuoteAsset: liveQuoteBalance,
          spendableQuoteAsset,
        },
      };
    }
  }

  if (snapshot.openPositions.length === 0) {
    return snapshot;
  }

  const latestPriceMap = await getLatestPriceMap({
    account,
    config,
    positions: snapshot.openPositions,
  });
  const exchangeType = runtimeAccountConfig.effective(
    config.management,
    account,
  ).exchangeType;

  return {
    ...snapshot,
    openPositions: snapshot.openPositions.map((position) =>
      withFloatingPnl(position, latestPriceMap[position.symbol], exchangeType),
    ),
  };
}

/** Selects the latest successful run for each stage across account snapshots. */
function combineLatestStageRuns(
  states: RuntimeDashboardState[],
): RuntimeStageRunStatsMap {
  const stageRuns: RuntimeStageRunStatsMap = {};

  for (const state of states) {
    for (const [stage, run] of Object.entries(state.stats.stageRuns)) {
      const stageKey = stage as keyof RuntimeStageRunStatsMap;
      if (!run) continue;
      if ((stageRuns[stageKey]?.t ?? 0) < run.t) {
        stageRuns[stageKey] = run;
      }
    }
  }

  return stageRuns;
}

/** Merges per-account snapshots into the combined dashboard response. */
function combineStates(states: RuntimeDashboardState[]): RuntimeDashboardState {
  const primary = states[0]!;
  // PROD:MULTI_ACCOUNT_COMBINED_DASHBOARD
  const history = states
    .flatMap((state) => state.history)
    .sort((left, right) => (right.closed?.t ?? 0) - (left.closed?.t ?? 0));
  const openPositions = states
    .flatMap((state) => state.openPositions)
    .sort((left, right) => left.opened.t - right.opened.t);
  const latestState = states.reduce((latest, state) =>
    (state.stats.lastRunAt ?? 0) > (latest.stats.lastRunAt ?? 0)
      ? state
      : latest,
  );

  return {
    ...primary,
    accountFilter: null,
    accountSummaries: states.flatMap((state) => state.accountSummaries),
    balances: {
      availableQuoteAsset: states.reduce(
        (total, state) => total + state.balances.availableQuoteAsset,
        0,
      ),
      reservedQuoteAsset: states.reduce(
        (total, state) => total + state.balances.reservedQuoteAsset,
        0,
      ),
      spendableQuoteAsset: states.reduce(
        (total, state) => total + state.balances.spendableQuoteAsset,
        0,
      ),
      safeHaven: states.reduce(
        (total, state) => total + state.balances.safeHaven,
        0,
      ),
      lockedQuoteAsset: states.reduce(
        (total, state) => total + state.balances.lockedQuoteAsset,
        0,
      ),
      startingBalanceUSDT: states.reduce(
        (total, state) => total + state.balances.startingBalanceUSDT,
        0,
      ),
    },
    history,
    openPositions,
    stats: {
      ...latestState.stats,
      closedTrades: history.length,
      openPositions: openPositions.length,
      stageRuns: combineLatestStageRuns(states),
      safeHavenLastScheduledAt: Math.max(
        0,
        ...states.map((state) => state.stats.safeHavenLastScheduledAt ?? 0),
      ),
    },
  };
}

/**
 * Builds the dashboard snapshot for one account with realtime enrichment:
 * Binance health, live balance (live mode only), floating PnL, and the public
 * instance IP.
 */
async function buildRealtime(params: {
  account?: string;
  options?: RuntimeDashboardRealtimeOptions;
}): Promise<RuntimeDashboardState> {
  const catalog = await runtimeStorage.catalog.ensure();
  const mode = params.options?.mode ?? catalog.mode;
  const requestedSlug = params.account?.trim();
  const account =
    catalog.config.accounts.find((item) => item.slug === requestedSlug) ??
    catalog.config.accounts[0];
  if (!account) {
    throw new Error("Cannot build the dashboard without accounts.");
  }

  const [source, status] = await Promise.all([
    loadAccountSource({
      account,
      mode,
    }),
    runtimeStorage.status.load(mode),
  ]);
  let snapshot = buildState({
    account,
    config: catalog.config,
    mode,
    source,
    status,
  });

  snapshot = await applyRealtime({
    account,
    config: catalog.config,
    options: params.options,
    state: snapshot,
  });

  const [binanceHealth, instanceIp] = await Promise.all([
    runtimeBinanceHealth.snapshot.read({ limit: 20 }),
    runtimeInstanceIp.storage.read(),
  ]);

  return {
    ...snapshot,
    binanceHealth,
    instanceIp: instanceIp ?? undefined,
  };
}

/**
 * Builds the combined dashboard snapshot across every persisted account,
 * applying realtime enrichment per account without mixing persisted state.
 */
async function buildCombined(
  options?: RuntimeDashboardRealtimeOptions,
): Promise<RuntimeDashboardState> {
  const catalog = await runtimeStorage.catalog.ensure();
  if (catalog.config.accounts.length === 0) {
    throw new Error("Cannot build a combined dashboard without accounts.");
  }

  const mode = options?.mode ?? catalog.mode;
  const status = await runtimeStorage.status.load(mode);
  const states: RuntimeDashboardState[] = [];
  for (const account of catalog.config.accounts) {
    const source = await loadAccountSource({
      account,
      mode,
    });
    const snapshot = buildState({
      account,
      config: catalog.config,
      mode,
      source,
      status,
    });
    states.push(
      await applyRealtime({
        account,
        config: catalog.config,
        options,
        state: snapshot,
      }),
    );
  }

  const [binanceHealth, instanceIp] = await Promise.all([
    runtimeBinanceHealth.snapshot.read({ limit: 20 }),
    runtimeInstanceIp.storage.read(),
  ]);

  return {
    ...combineStates(states),
    binanceHealth,
    instanceIp: instanceIp ?? undefined,
  };
}

/** Result of one manual live-balance refresh. */
export interface RuntimeBalanceRefreshResult {
  account: string;
  availableQuoteAsset: number;
  refreshedAt: number;
}

/** Refreshes and persists one live account balance after an explicit request. */
async function refreshAccount(
  accountSlug: string,
): Promise<RuntimeBalanceRefreshResult> {
  const catalog = await runtimeStorage.catalog.ensure();
  const account = catalog.config.accounts.find(
    (item) => item.slug === accountSlug,
  );
  if (!account) {
    throw new Error(`Unknown exchange account: ${accountSlug}`);
  }
  if (catalog.mode !== "live") {
    throw new Error(
      `${account.name ?? account.slug} is in sandbox mode; its balance is managed locally.`,
    );
  }

  const effective = runtimeAccountConfig.effective(
    catalog.config.management,
    account,
  );
  const balance = await runWithExchangeAccount(
    runtimeAccountState.toExchangeAccount(account),
    () =>
      getExchange(effective.exchangeType, {
        defaultTradingMode: toExchangeTradingMode(effective.tradingMode),
      }).getBalance("USDT_USDT"),
  );
  if (!balance || !Number.isFinite(balance.quoteAsset)) {
    throw new Error(
      `Can't fetch live balance for ${account.name ?? account.slug}.`,
    );
  }

  await jsonFile.update.atomic(
    storageFiles.prod.account(account.slug, "live").balance,
    (raw) => {
      const memory =
        raw && typeof raw === "object" && !Array.isArray(raw)
          ? { ...(raw as Record<string, unknown>) }
          : {};
      runtimeAccountState.applyLiveQuoteAsset(
        memory,
        balance.quoteAsset,
      );
      return memory;
    },
  );

  return {
    account: account.slug,
    availableQuoteAsset: balance.quoteAsset,
    refreshedAt: Date.now(),
  };
}

/** Grouped dashboard read model over the persistent runtime layout. */
const systemDashboard = {
  balance: {
    refresh: refreshAccount,
  },
  state: {
    build: buildState,
    buildCombined,
    buildRealtime,
  },
} as const;

export default systemDashboard;
export { systemDashboard };
export { default as runtimeMarketVolume } from "./market-volume";
export type {
  RuntimeVolume24hSnapshot,
  RuntimeVolumeMarketType,
} from "./market-volume";
export type * from "./types";
