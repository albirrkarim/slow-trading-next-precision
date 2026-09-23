import {
  getExchange,
  TradingMode,
  type ExchangeType,
  type IExchange,
} from "@/lib/exchange";
import {
  runWithExchangeAccount,
  type ExchangeAccount,
} from "@/lib/exchange/account-context";
import type {
  RuntimeDecision,
  RuntimeEngineAdapter,
  RuntimeEngineState as PrecisionRuntimeState,
} from "@/lib/precision/types";
import { systemLog } from "@/lib/system/logging";
import type {
  RuntimeAccountConfig,
  RuntimeControlConfig,
} from "@/lib/system/runtime";
import {
  runtimeAccountState as accountState,
  runtimeStorage,
} from "@/lib/system/storage";
import type { RuntimeAccountModeState } from "@/lib/system/storage";
import tradingAveraging from "@/lib/system/trading/averaging";
import blackSwan from "@/lib/system/trading/black-swan";
import runtimeDailyPnlLimit from "@/lib/system/trading/daily-pnl-limit";
import entryAction from "@/lib/system/trading/entry-action";
import tradingExit from "@/lib/system/trading/exit";
import type { BalanceSummary, Position } from "@/lib/system/trading";
import vpoints from "@/lib/system/utils/vpoints";
import adapter from "./adapter";
import clock from "./clock";
import execution from "./execution";
import productionStages from "./stages";
import state from "./state";
import vpointFiles from "./vpoints";
import type { ProductionRuntimeFactory } from "./types";

interface AccountRuntime {
  account: RuntimeAccountConfig;
  exchange: IExchange;
  exchangeAccount: ExchangeAccount;
  mode: "live" | "sandbox";
  state: RuntimeAccountModeState;
}

type AccountRuntimes = Map<string, AccountRuntime>;

/** Merges shared management settings with one account's trading overrides. */
function effectiveTrading(
  management: PrecisionRuntimeState["config"]["management"],
  account: RuntimeAccountConfig,
) {
  return { ...management, ...account.trading };
}

/** Maps the runtime trading mode to the exchange enum. */
function toExchangeTradingMode(tradingMode?: string): TradingMode {
  return tradingMode === "futures" ? TradingMode.FUTURES : TradingMode.SPOT;
}

/** Strips runtime secrets so the engine config never carries MCP tokens. */
function buildRuntimeConfig(
  runtime: RuntimeControlConfig,
): PrecisionRuntimeState["config"]["runtime"] {
  // PROD:RUNTIME_CONFIG_ACCOUNT_SOURCE
  return { ...runtime, mcp: { tokens: [] } };
}

/** Persists one account's open positions and balance after a state change. */
async function persistAccount(
  context: { state: PrecisionRuntimeState },
  accountRuntime: AccountRuntime,
): Promise<void> {
  const balance = context.state.balance[accountRuntime.account.slug];
  if (balance) {
    accountState.syncBalance(accountRuntime.state.balance, balance);
  }
  accountRuntime.state.positions = context.state.openPositions.filter(
    (position) =>
      position.account === accountRuntime.account.slug && !position.closed,
  );
  await runtimeStorage.account.save({
    accountSlug: accountRuntime.account.slug,
    mode: accountRuntime.mode,
    state: accountRuntime.state,
  });
}

/**
 * Final approval gate for every runtime decision. Manual operator actions
 * bypass `runnerEnabled` like the legacy manual routes, while Black Swan
 * protection still blocks every entry and averaging — including forced
 * ones — and the persisted daily-PnL stop blocks automatic entries.
 */
async function isActionAllowed(
  decision: RuntimeDecision,
  runtimeState: PrecisionRuntimeState,
  accountRuntimes: AccountRuntimes,
): Promise<boolean> {
  const accountRuntime = accountRuntimes.get(decision.accountSlug);
  if (!accountRuntime) return false;

  const manual =
    decision.type === "entry"
      ? Boolean(decision.manual)
      : decision.type === "exit"
        ? Boolean(decision.position.control?.forceExit)
        : false;

  if (!manual && !runtimeState.config.runtime.runnerEnabled) return false;

  if (decision.type === "exit") {
    return manual || runtimeState.config.runtime.autoExitEnabled;
  }

  const status = await runtimeStorage.status
    .load(
      runtimeState.mode === "sandbox" ? "sandbox" : "live",
    )
    .catch(() => ({}) as Awaited<ReturnType<typeof runtimeStorage.status.load>>);

  // Black Swan protection blocks entries and averaging, including manual
  // entries — the legacy cycle emptied every entry signal during a crisis.
  if (blackSwan.state.isProtective(status.blackSwan)) {
    return false;
  }

  if (decision.type === "averaging") {
    return true;
  }

  if (!accountRuntime.account.enabled) return false;
  if (manual) return true;
  if (!runtimeState.config.runtime.autoEntryEnabled) return false;

  const limit = status.dailyPnlLimitState;
  if (limit) {
    const evaluation = runtimeDailyPnlLimit.guard.evaluatePnl({
      currentTimeMs: runtimeState.currentTime,
      pnlUsdt: limit.usdt,
      thresholdUsdt:
        runtimeState.config.runtime.autoEntryDailyPnlLimitUSDT,
    });
    if (evaluation.reached && evaluation.day === limit.d) {
      return false;
    }
  }

  return true;
}

function createActionHandlers(
  accountRuntimes: AccountRuntimes,
  onVPointsChanged: (
    vPointsMap: PrecisionRuntimeState["vPointsMap"],
  ) => Promise<void>,
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
    const executeSafely = async <T>(
      fn: () => T | Promise<T>,
    ): Promise<T | null> => {
      try {
        return await fn();
      } catch (error) {
        systemLog.error(
          `[Precision Runtime] ${decision.type} failed for ` +
            `${decision.accountSlug}/${decision.symbol}`,
          error,
        );
        return null;
      }
    };
    const runInAccount = <T>(fn: () => Promise<T>) =>
      runWithExchangeAccount(accountRuntime.exchangeAccount, fn);

    // Live refreshes the authoritative exchange balance before every order.
    if (accountRuntime.mode === "live") {
      try {
        await runInAccount(async () => {
          const exchangeBalance =
            await accountRuntime.exchange.getBalance("USDT_USDT");
          if (exchangeBalance) {
            accountState.applyLiveQuoteAsset(
              accountRuntime.state.balance,
              exchangeBalance.quoteAsset,
            );
          }
        });
        context.state.balance[decision.accountSlug] =
          accountState.buildBalance({
            balance: accountRuntime.state.balance,
            positions: context.state.openPositions.filter(
              (position) =>
                position.account === decision.accountSlug && !position.closed,
            ),
          });
      } catch (error) {
        systemLog.warn(
          `[Precision Runtime] balance refresh failed for ${decision.accountSlug}`,
          error,
        );
      }
    }

    // Sandbox shares the exact simulated fills used by backtest — one code
    // path for position math; only the fill source differs from live.
    if (accountRuntime.mode === "sandbox") {
      if (decision.type === "entry") {
        return executeSafely(() => entryAction.execute(context, decision));
      }
      if (decision.type === "averaging") {
        return executeSafely(() => tradingAveraging.execute(context, decision));
      }
      return executeSafely(() => tradingExit.execute(context, decision));
    }

    // Live places real exchange orders, then applies the executed fill through
    // the same position math the simulation uses.
    if (decision.type === "entry") {
      return executeSafely(() =>
        runInAccount(() =>
          execution.entry({
            context,
            decision,
            exchange: accountRuntime.exchange,
          }),
        ),
      );
    }
    if (decision.type === "averaging") {
      return executeSafely(() =>
        runInAccount(() =>
          execution.averaging({
            context,
            decision,
            exchange: accountRuntime.exchange,
          }),
        ),
      );
    }
    return executeSafely(() =>
      runInAccount(() =>
        execution.exit({
          context,
          decision,
          exchange: accountRuntime.exchange,
        }),
      ),
    );
  };

  const onExit: RuntimeEngineAdapter["onExit"] = async (position, context) => {
    const accountRuntime = accountRuntimes.get(position.account);
    if (!accountRuntime) return;
    await persistAccount(context, accountRuntime);
    await runtimeStorage.history
      .append({ mode: accountRuntime.mode, position })
      .catch((error) => {
        systemLog.error(
          `[Precision Runtime] history append failed for ` +
            `${position.account}/${position.symbol}`,
          error,
        );
      });
    pendingAccountSlug = undefined;
  };

  const onStateChange: RuntimeEngineAdapter["onStateChange"] = async (
    context,
  ) => {
    const accountSlug = pendingAccountSlug;
    if (!accountSlug) return;
    const accountRuntime = accountRuntimes.get(accountSlug);
    if (!accountRuntime) return;
    await persistAccount(context, accountRuntime);
    pendingAccountSlug = undefined;
    // Entries and averagings mark `usedBy<slug>` on vPoints right before this
    // hook fires; flushing the retained window writes those markers to disk.
    await onVPointsChanged(context.state.vPointsMap);
  };

  return { onAction, onExit, onStateChange, onStrategy };
}

/** Recent vPoints seeded per symbol when production boots. */
const BOOTSTRAP_VPOINT_COUNT = 7;

function createProductionFactory(): ProductionRuntimeFactory {
  const accountRuntimes: AccountRuntimes = new Map();
  const symbolExchangeMap = new Map<string, ExchangeType>();
  let latestState: PrecisionRuntimeState | undefined;

  /** Merges the given vPoints into each symbol's persisted volatility file. */
  const persistVPointsToFiles = async (
    vPointsMap: PrecisionRuntimeState["vPointsMap"],
  ) => {
    for (const [symbol, points] of Object.entries(vPointsMap)) {
      const exchangeType = symbolExchangeMap.get(symbol.toUpperCase());
      if (!exchangeType || points.length === 0) continue;
      try {
        await vpointFiles.persistPoints({ exchangeType, symbol, points });
      } catch (error) {
        systemLog.warn(
          `[Precision Runtime] vPoint persist failed for ${symbol}`,
          error,
        );
      }
    }
  };

  const createState: ProductionRuntimeFactory["createState"] = async () => {
    accountRuntimes.clear();
    symbolExchangeMap.clear();
    const catalog = await runtimeStorage.catalog.load();
    const mode = catalog.mode;
    const openPositions: Position[] = [];
    const balance: Record<string, BalanceSummary> = {};
    const vPointsMap: PrecisionRuntimeState["vPointsMap"] = {};
    const vPointSources = new Map<
      string,
      { exchangeType: ExchangeType; symbol: string }
    >();

    // PROD:RUNTIME_ACCOUNT_STATE_LOAD
    for (const account of catalog.config.accounts) {
      try {
        const trading = effectiveTrading(catalog.config.management, account);
        const accountModeState = await runtimeStorage.account.load({
          accountSlug: account.slug,
          mode,
        });
        const exchange = getExchange(trading.exchangeType, {
          defaultTradingMode: toExchangeTradingMode(trading.tradingMode),
        });
        const exchangeAccount = accountState.toExchangeAccount(account);

        if (mode === "sandbox") {
          accountState.ensureSandboxBalance(
            accountModeState,
            account.sandbox.initialBalanceUSDT,
          );
        } else {
          try {
            await runWithExchangeAccount(exchangeAccount, async () => {
              const exchangeBalance =
                await exchange.getBalance("USDT_USDT");
              if (exchangeBalance) {
                accountState.applyLiveQuoteAsset(
                  accountModeState.balance,
                  exchangeBalance.quoteAsset,
                );
              }
            });
          } catch (error) {
            systemLog.warn(
              `[Precision Runtime] initial balance refresh failed for ${account.slug}`,
              error,
            );
          }
        }

        const runtime: AccountRuntime = {
          account,
          exchange,
          exchangeAccount,
          mode,
          state: accountModeState,
        };
        accountRuntimes.set(account.slug, runtime);
        balance[account.slug] = accountState.buildBalance({
          balance: accountModeState.balance,
          positions: accountModeState.positions,
        });
        openPositions.push(
          ...accountModeState.positions.filter(
            (position) => !position.closed,
          ),
        );

        for (const symbol of catalog.config.management.symbols) {
          const normalized = symbol.toUpperCase();
          symbolExchangeMap.set(normalized, trading.exchangeType);
          vPointSources.set(`${trading.exchangeType}:${normalized}`, {
            exchangeType: trading.exchangeType,
            symbol: normalized,
          });
        }
      } catch (error) {
        systemLog.error(
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
      const points = await runtimeStorage.vpoints.read({
        exchangeType: source.exchangeType,
        symbol: source.symbol,
      });
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
        accounts: catalog.config.accounts,
        management: catalog.config.management,
        runtime: buildRuntimeConfig(catalog.config.runtime),
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

    const firstRuntime = accountRuntimes.values().next()
      .value as AccountRuntime;
    const handlers = createActionHandlers(
      accountRuntimes,
      persistVPointsToFiles,
    );
    return adapter.create({
      clock: clock.create({ signal }),
      exchange: firstRuntime.exchange,
      getBalance: async (accountSlug) =>
        latestState?.balance[accountSlug ?? ""]?.available ?? 0,
      onAction: handlers.onAction,
      onCycleComplete: productionStages.cycleComplete,
      onExit: handlers.onExit,
      onManagement: productionStages.management,
      onNewVPoint: async (symbol, newVPoint) => {
        // Each detected point is merged into the shared volatility file
        // immediately so a restart seeds from fresh data instead of
        // re-fetching the whole detection window.
        await persistVPointsToFiles({ [symbol.toUpperCase()]: [newVPoint] });
      },
      onRiskSentinel: productionStages.riskSentinel,
      onStageStats: productionStages.stageStats,
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
