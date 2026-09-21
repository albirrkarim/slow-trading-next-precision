import type { BalanceSummary } from "@/components/LiveDashboard/Navbar/Settings/settings-types";
import { FILES } from "@/components/storage";
import { getExchange, type ExchangeType, type IExchange } from "@/lib/exchange";
import type { Kline } from "@/lib/exchange/platform/tokocrypto";
import slowTradingBalance from "@/lib/slowTrading/balance";
import slowTradingStorage from "@/lib/slowTrading/storage";
import type {
  SlowTradingMode,
  SlowTradingModeState,
  SlowTradingStorageData,
} from "@/lib/slowTrading/types";
import trading from "@/lib/trading";
import { tradeLog } from "@/lib/trading/helper/log";
import type {
  Position,
  TradingModelMemory,
} from "@/lib/trading/models";
import type {
  RuntimeDecision,
  RuntimeEngineAdapter,
  RuntimeEngineState as PrecisionRuntimeState,
} from "@/lib/precision/types";
import clock from "./clock";
import adapter from "./adapter";
import state from "./state";
import vpoints from "./vpoints";
import type { ProductionRuntimeFactory } from "./types";

interface AccountRuntime {
  exchange: IExchange;
  mode: SlowTradingMode;
  modeState: SlowTradingModeState;
  storage: SlowTradingStorageData;
}

type AccountRuntimes = Map<string, AccountRuntime>;

function finite(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function getOpenPositions(modeState: SlowTradingModeState): Position[] {
  return modeState.tradeSettings.flatMap((setting) =>
    (setting.model_memory.positions ?? []).filter((position) => !position.closed),
  );
}

function buildBalance(modeState: SlowTradingModeState): BalanceSummary {
  const memory = modeState.dynamicTradeMemory;
  const safeHaven = Math.max(0, finite(memory.safeHaven));
  const quoteAsset = Math.max(0, finite(memory.quoteAsset));
  const available = quoteAsset + safeHaven;
  const reserved = Math.max(0, finite(memory.reservedQuoteAsset));
  const locked = getOpenPositions(modeState).reduce(
    (total, position) => total + Math.max(0, finite(position.exposure.marginUsdt)),
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

function getModelMemory(runtime: AccountRuntime, symbol: string): TradingModelMemory {
  const normalized = symbol.toUpperCase();
  const setting = runtime.modeState.tradeSettings.find(
    (candidate) => candidate.symbol.toUpperCase() === normalized,
  );
  if (!setting) {
    throw new Error(`Production trade setting not found for ${normalized}.`);
  }
  return setting.model_memory;
}

function getAllModelMemories(runtime: AccountRuntime): TradingModelMemory[] {
  return runtime.modeState.tradeSettings.map((setting) => setting.model_memory);
}

function buildPrecisionRuntimeConfig(
  runtime: SlowTradingStorageData["runtime"],
): PrecisionRuntimeState["config"]["runtime"] {
  const { mcp: _mcp, ...runtimeConfig } = runtime;

  // PROD:RUNTIME_CONFIG_ACCOUNT_SOURCE
  // Precision uses config.accounts as the single account source; runtime MCP
  // tokens are stripped so secrets never reach the engine config.
  return {
    ...runtimeConfig,
    mcp: { tokens: [] },
  } as PrecisionRuntimeState["config"]["runtime"];
}

function createCurrentKline(
  runtimeState: PrecisionRuntimeState,
  symbol: string,
): Kline {
  const mark = runtimeState.markPriceMap[symbol.toUpperCase()];
  if (!mark) {
    throw new Error(`Production mark price not found for ${symbol}.`);
  }

  const price = String(mark.price);
  return [
    runtimeState.currentTime,
    price,
    price,
    price,
    price,
    "0",
    runtimeState.currentTime,
    "0",
    0,
    "0",
    "0",
    "",
    new Date(runtimeState.currentTime).toISOString(),
  ];
}

function getBalanceOverride(
  runtimeState: PrecisionRuntimeState,
  accountSlug: string,
) {
  const balance = runtimeState.balance[accountSlug];
  return {
    baseAsset: 0,
    quoteAsset: Math.max(0, balance?.available ?? 0) -
      Math.max(0, balance?.safeHaven ?? 0),
  };
}

function syncBalanceToModeState(
  runtimeState: PrecisionRuntimeState,
  accountRuntime: AccountRuntime,
): void {
  const balance = runtimeState.balance[accountRuntime.storage.account.slug];
  if (!balance) return;

  const safeHaven = Math.max(0, finite(accountRuntime.modeState.dynamicTradeMemory.safeHaven));
  accountRuntime.modeState.dynamicTradeMemory.quoteAsset = Math.max(
    0,
    balance.available - safeHaven,
  );
  accountRuntime.modeState.dynamicTradeMemory.reservedQuoteAsset = Math.max(
    0,
    balance.reserved,
  );
}

async function persistAccount(
  runtimeState: PrecisionRuntimeState,
  accountRuntime: AccountRuntime,
): Promise<void> {
  syncBalanceToModeState(runtimeState, accountRuntime);
  await slowTradingStorage.mode.saveState(
    accountRuntime.mode,
    accountRuntime.modeState,
    { account: accountRuntime.storage.account.slug },
  );
}

function isActionAllowed(
  decision: RuntimeDecision,
  runtimeState: PrecisionRuntimeState,
  accountRuntimes: AccountRuntimes,
): boolean {
  if (!runtimeState.config.runtime.runnerEnabled) return false;

  const accountRuntime = accountRuntimes.get(decision.accountSlug);
  if (!accountRuntime) return false;

  if (decision.type === "entry") {
    return (
      accountRuntime.storage.account.enabled &&
      runtimeState.config.runtime.autoEntryEnabled
    );
  }

  if (decision.type === "exit") {
    return (
      runtimeState.config.runtime.autoExitEnabled ||
      Boolean(decision.position.control?.forceExit)
    );
  }

  return true;
}

function createActionHandlers(
  accountRuntimes: AccountRuntimes,
): Pick<
  RuntimeEngineAdapter,
  "onAction" | "onExit" | "onStateChange" | "onStrategy"
> {
  let pendingAccountSlug: string | undefined;

  const onStrategy: RuntimeEngineAdapter["onStrategy"] = async (
    decision,
    context,
  ) => isActionAllowed(decision, context.state, accountRuntimes);

  const onAction: RuntimeEngineAdapter["onAction"] = async (
    decision,
    context,
  ) => {
    const accountRuntime = accountRuntimes.get(decision.accountSlug);
    if (!accountRuntime) return null;

    pendingAccountSlug = decision.accountSlug;
    const { storage, mode, modeState } = accountRuntime;
    const config = storage.config;
    const modelMemory = getModelMemory(accountRuntime, decision.symbol);
    let balance = context.state.balance[decision.accountSlug];
    let balanceOverride = getBalanceOverride(context.state, decision.accountSlug);
    const runInAccount = <T>(fn: () => Promise<T>) =>
      slowTradingStorage.account.runWithExchangeAccount(storage, fn);
    const executeSafely = async <T>(fn: () => Promise<T>): Promise<T | null> => {
      try {
        return await fn();
      } catch (error) {
        tradeLog.error(
          `[Precision Runtime] ${decision.type} failed for ${decision.accountSlug}/${decision.symbol}`,
          error,
        );
        return null;
      }
    };

    if (mode === "live") {
      try {
        await runInAccount(async () => {
          const exchangeBalance = await accountRuntime.exchange.getBalance("USDT_USDT");
          if (exchangeBalance) {
            slowTradingBalance.live.applyAvailableQuoteAsset({
              dynamicTradeMemory: modeState.dynamicTradeMemory,
              quoteAsset: exchangeBalance.quoteAsset,
            });
          }
        });
        context.state.balance[decision.accountSlug] = buildBalance(modeState);
        balance = context.state.balance[decision.accountSlug];
        balanceOverride = getBalanceOverride(context.state, decision.accountSlug);
      } catch (error) {
        tradeLog.warn(
          `[Precision Runtime] balance refresh failed for ${decision.accountSlug}`,
          error,
        );
      }
    }

    if (decision.type === "entry") {
      // The shared runtime supplies the current budget explicitly. Do not let
      // an old cycle's legacy quoteAssetToTrade override that budget.
      delete modelMemory.quoteAssetToTrade;
      const report = await executeSafely(() => runInAccount(() =>
        trading.execution.entry({
          allModelMemories: getAllModelMemories(accountRuntime),
          balanceOverride,
          bypass: context.state.config.runtime.entrySignalBypass,
          current: createCurrentKline(context.state, decision.symbol),
          dynamicTradeConfig: config,
          entrySignal: decision.entrySignal,
          executionMode: mode,
          exchangeType: config.exchangeType,
          investAmount: Math.max(0, balance?.spendable ?? 0),
          modelMemory,
          reservedQuoteAsset: balance?.reserved ?? 0,
          simulate: mode === "sandbox",
          tradingConfig: config,
          tradingMode: config.tradingMode,
        }),
      ));
      if (!report || report.tradingDetail?.action !== "BUY") return null;
      return modelMemory.positions.at(-1) ?? null;
    }

    if (decision.type === "averaging") {
      const report = await executeSafely(() => runInAccount(() =>
        trading.execution.averaging({
          accountSlug: decision.accountSlug,
          adaptiveAveraging: config.adaptiveAveraging,
          averagingRecommendation: decision.recommendation,
          averagingRescueProjectionGuardEnabled:
            config.averagingRescueProjectionGuardEnabled !== false,
          balanceOverride,
          exchangeType: config.exchangeType,
          modelMemory,
          reservedQuoteAsset: balance?.reserved ?? 0,
          symbol: decision.symbol,
          tradingConfig: config,
          tradingMode: config.tradingMode,
          volatilityPoints: context.state.vPointsMap[decision.symbol] ?? [],
        }),
      ));
      if (!report || report.tradingDetail?.action !== "BUY") return null;
      return modelMemory.positions[0] ?? null;
    }

    const report = await executeSafely(() => runInAccount(() =>
      trading.execution.exit({
        balanceOverride,
        bypass: false,
        current: createCurrentKline(context.state, decision.symbol),
        exchangeType: config.exchangeType,
        modelMemory,
        simulate: mode === "sandbox",
        symbol: decision.symbol,
        tradingConfig: config,
        tradingMode: config.tradingMode,
      }),
    ));
    if (!report || report.tradingDetail?.action !== "SELL") return null;
    return modelMemory.positionsSell?.at(-1) ?? null;
  };

  const onExit: RuntimeEngineAdapter["onExit"] = async (position, context) => {
    const accountRuntime = accountRuntimes.get(position.account);
    if (!accountRuntime) return;
    await persistAccount(context.state, accountRuntime);
    pendingAccountSlug = undefined;
  };

  const onStateChange: RuntimeEngineAdapter["onStateChange"] = async (
    context,
  ) => {
    const accountSlug = pendingAccountSlug;
    if (!accountSlug) return;
    const accountRuntime = accountRuntimes.get(accountSlug);
    if (!accountRuntime) return;
    await persistAccount(context.state, accountRuntime);
    pendingAccountSlug = undefined;
  };

  return { onAction, onExit, onStateChange, onStrategy };
}

/** Recent vPoints seeded per symbol when production boots. */
const BOOTSTRAP_VPOINT_COUNT = 7;

function createProductionFactory(): ProductionRuntimeFactory {
  const accountRuntimes: AccountRuntimes = new Map();
  let latestState: PrecisionRuntimeState | undefined;

  const createState: ProductionRuntimeFactory["createState"] = async () => {
    accountRuntimes.clear();
    const catalog = await slowTradingStorage.data.load({ modeScope: "active" });
    const mode = slowTradingStorage.mode.getActive(catalog);
    const openPositions: Position[] = [];
    const balance: Record<string, BalanceSummary> = {};
    const vPointsMap: PrecisionRuntimeState["vPointsMap"] = {};
    const vPointSources = new Map<
      string,
      { exchangeType: ExchangeType; symbol: string }
    >();

    // PROD:RUNTIME_ACCOUNT_STATE_LOAD
    for (const account of catalog.accounts) {
      try {
        const storage = await slowTradingStorage.data.load({
          account: account.slug,
          modeScope: "all",
        });
        const modeState = slowTradingStorage.mode.ensureTradeSettings(
          storage.modes[mode],
          storage.config.symbols,
        );
        storage.modes[mode] = modeState;
        const exchange = getExchange(storage.config.exchangeType, {
          defaultTradingMode: storage.config.tradingMode,
        });

        if (mode === "sandbox") {
          slowTradingBalance.sandbox.ensureBalance(
            modeState,
            storage.account.sandbox.initialBalanceUSDT,
          );
        } else {
          try {
            await slowTradingStorage.account.runWithExchangeAccount(storage, async () => {
              const exchangeBalance = await exchange.getBalance("USDT_USDT");
              if (exchangeBalance) {
                slowTradingBalance.live.applyAvailableQuoteAsset({
                  dynamicTradeMemory: modeState.dynamicTradeMemory,
                  quoteAsset: exchangeBalance.quoteAsset,
                });
              }
            });
          } catch (error) {
            tradeLog.warn(
              `[Precision Runtime] initial balance refresh failed for ${account.slug}`,
              error,
            );
          }
        }

        const runtime = { exchange, mode, modeState, storage };
        accountRuntimes.set(account.slug, runtime);
        balance[account.slug] = buildBalance(modeState);
        openPositions.push(...getOpenPositions(modeState));

        for (const setting of modeState.tradeSettings) {
          const symbol = setting.symbol.toUpperCase();
          vPointSources.set(`${storage.config.exchangeType}:${symbol}`, {
            exchangeType: storage.config.exchangeType,
            symbol,
          });
        }
      } catch (error) {
        tradeLog.error(
          `[Precision Runtime] account load failed for ${account.slug}`,
          error,
        );
      }
    }

    if (accountRuntimes.size === 0) {
      throw new Error("Precision production runtime has no loadable accounts.");
    }

    // PROD:VPOINTS_BOOTSTRAP_FROM_STORAGE
    // Seeds vPointsMap from the persisted per-symbol volatility files instead
    // of transient model memory: each file keeps the full detected point list
    // including `usedBy<accountSlug>` markers, so a restart does not re-consume
    // entry signals. The latest 7 points are injected, expanded by the shared
    // retention rule so open positions keep their referenced/post-entry
    // vPoints. Runtime market updates merge new points on top of this seed.
    for (const source of vPointSources.values()) {
      const points = await FILES.slow.volatilityPoints.get(
        source.exchangeType,
        source.symbol,
      );
      if (!points?.length) continue;
      const retained = vpoints.retainRecent({
        symbol: source.symbol,
        points,
        positions: openPositions,
        recent: BOOTSTRAP_VPOINT_COUNT,
      });
      if (retained.length > (vPointsMap[source.symbol]?.length ?? 0)) {
        vPointsMap[source.symbol] = retained;
      }
    }

    const runtimeState = state.create({
      balance,
      config: {
        accounts: catalog.accounts,
        management: catalog.sharedConfig,
        runtime: buildPrecisionRuntimeConfig(catalog.runtime),
      },
      currentTime: Date.now(),
      mode,
      openPositions,
      vPointsMap,
      markPriceMap: {},
    });
    latestState = runtimeState;
    return runtimeState;
  };

  const createAdapter: ProductionRuntimeFactory["createAdapter"] = async ({
    signal,
  }) => {
    if (!latestState || accountRuntimes.size === 0) {
      throw new Error("Production state must be created before its adapter.");
    }

    const firstRuntime = accountRuntimes.values().next().value as AccountRuntime;
    const handlers = createActionHandlers(accountRuntimes);
    return adapter.create({
      clock: clock.create({ signal }),
      exchange: firstRuntime.exchange,
      getBalance: async (accountSlug) =>
        latestState?.balance[accountSlug ?? ""]?.available ?? 0,
      onAction: handlers.onAction,
      onExit: handlers.onExit,
      onStateChange: handlers.onStateChange,
      onStrategy: handlers.onStrategy,
      signal,
    });
  };

  return { createAdapter, createState };
}

const factory = { create: createProductionFactory } as const;

export default factory;
export { createProductionFactory, factory };
