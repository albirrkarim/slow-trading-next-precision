import { getFeeCalculator } from "@/lib/exchange/fees";
import { RuntimeEngine } from "@/lib/precision";
import type {
  RuntimeEngineAdapter,
  RuntimeEngineState,
} from "@/lib/precision/types";
import type { RuntimeConfig } from "@/lib/system/runtime/types";
import { runtimeAccountConfig } from "@/lib/system/runtime/account-config";
import { runtimeDefaults } from "@/lib/system/runtime/defaults";
import type { VolatilityPoint } from "@/lib/system/types";
import vpoints from "@/lib/system/utils/vpoints";
import tradingAveraging from "@/lib/system/trading/averaging";
import tradingEntry from "@/lib/system/trading/entry";
import entryAction from "@/lib/system/trading/entry-action";
import tradingExit from "@/lib/system/trading/exit";
import pnl from "@/lib/system/trading/pnl";
import type { Position } from "@/lib/system/trading/types";
import { prepareQuickBacktestDataset } from "./dataset";
import quickBacktestReport from "./report";
import type {
  RuntimeQuickBacktestGrowthPoint,
  RuntimeQuickBacktestInput,
  RuntimeQuickBacktestResult,
} from "./types";

const QUICK_BACKTEST_ENTRY_CUTOFF_MS = 3 * 24 * 60 * 60_000;
const MINUTE_MS = 60_000;
const DEFAULT_ACCOUNT_SLUG = "quick-backtest";

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Rebuilds the engine's split runtime config from the dashboard's flat
 * effective config. Manual quick-backtest runs always enable the runtime
 * gates so the simulation can evaluate every detected signal.
 */
function buildRuntimeConfig({
  accountName,
  accountSlug,
  flatConfig,
  startAmount,
}: {
  accountName: string;
  accountSlug: string;
  flatConfig: RuntimeQuickBacktestInput["config"];
  startAmount: number;
}): RuntimeConfig {
  const management = runtimeAccountConfig.shared.fromEffective(
    runtimeDefaults.management.create(),
    flatConfig,
  );

  return {
    management,
    runtime: {
      ...runtimeDefaults.runtime.create(),
      autoEntryEnabled: true,
      autoExitEnabled: true,
      runnerEnabled: true,
      sandboxEnabled: true,
    },
    accounts: [
      {
        slug: accountSlug,
        name: accountName,
        type: management.exchangeType,
        description: "",
        credentials: { apiKey: "", apiSecret: "" },
        enabled: true,
        trading: runtimeAccountConfig.trading.fromEffective(flatConfig),
        sandbox: { initialBalanceUSDT: startAmount },
        createdAt: 0,
        updatedAt: 0,
      },
    ],
  };
}

/**
 * Sums the fee-aware unrealized USDT and open notional for the account's
 * open positions at the latest mark prices.
 */
function getOpenPositionExposure(
  state: RuntimeEngineState,
  accountSlug: string,
  roundTripFeeRatio: number,
): { floatingUsdt: number; openNotionalUsdt: number } {
  let floatingUsdt = 0;
  let openNotionalUsdt = 0;

  for (const position of state.openPositions) {
    if (position.account !== accountSlug || position.closed) continue;

    const markPrice = state.markPriceMap[position.symbol]?.price;
    openNotionalUsdt += Number.isFinite(markPrice)
      ? position.exposure.quantity * (markPrice as number)
      : position.exposure.notionalUsdt;

    if (Number.isFinite(markPrice)) {
      floatingUsdt +=
        pnl.computeClosedMetrics(
          position,
          markPrice as number,
          roundTripFeeRatio,
        )?.netProfitUSDT ?? 0;
    }
  }

  return { floatingUsdt, openNotionalUsdt };
}

/**
 * Runs a demand-only dashboard backtest over the visible window through the
 * shared precision runtime. Stored vPoints before `startTime` seed the
 * detector so in-range points are re-detected from real klines exactly like
 * production detects them.
 */
async function runSingle({
  accountName = DEFAULT_ACCOUNT_SLUG,
  accountSlug = DEFAULT_ACCOUNT_SLUG,
  flatConfig,
  startAmount = 100,
  input,
}: {
  accountName?: string;
  accountSlug?: string;
  flatConfig: RuntimeQuickBacktestInput["config"];
  startAmount?: number;
  input: RuntimeQuickBacktestInput;
}): Promise<RuntimeQuickBacktestResult> {
  const config = buildRuntimeConfig({
    accountName,
    accountSlug,
    flatConfig,
    startAmount,
  });
  const symbols = tradingEntry.getSymbols(config);
  const startingBalanceUSDT = Number.isFinite(startAmount) ? startAmount : 100;

  // Points stored before the range continue the live detection chain;
  // in-range points are re-detected by the engine itself.
  const initialVPointsMap: Record<string, VolatilityPoint[]> = {};
  const rangeStart = input.startTime ?? 0;
  const dataStartTimeBySymbol: Record<string, number> = {};
  for (const symbol of symbols) {
    const seeded = (input.volatilityMap?.[symbol] ?? [])
      .filter((point) => Number.isFinite(point.t) && point.t < rangeStart)
      .sort((left, right) => left.t - right.t);
    initialVPointsMap[symbol] = seeded;
    const lastSeeded = seeded.at(-1)?.t;
    if (Number.isFinite(lastSeeded)) {
      dataStartTimeBySymbol[symbol] = (lastSeeded as number) - 5 * MINUTE_MS;
    }
  }

  // BTEST:BACKTEST_DATASET
  const dataset = await prepareQuickBacktestDataset({
    dataStartTimeBySymbol,
    endTime: input.endTime,
    exchangeType: config.management.exchangeType,
    range: input.range,
    signal: input.signal,
    startTime: input.startTime,
    symbols,
    tradingMode: config.management.tradingMode,
  });
  const { endTime } = dataset;
  const startTime = Math.max(dataset.startTime, rangeStart);
  const entryCutoffTime = endTime - QUICK_BACKTEST_ENTRY_CUTOFF_MS;

  const state: RuntimeEngineState = {
    balance: {
      [accountSlug]: {
        available: startingBalanceUSDT,
        locked: 0,
        reserved: 0,
        safeHaven: 0,
        spendable: startingBalanceUSDT,
        startingBalance: startingBalanceUSDT,
        total: startingBalanceUSDT,
      },
    },
    config,
    currentTime: startTime,
    mode: "backtest",
    openPositions: [],
    markPriceMap: {},
    vPointsMap: cloneJson(initialVPointsMap),
    volume24hMap: input.volume24hBySymbol,
  };

  const roundTripFeeRatio =
    getFeeCalculator(config.management.exchangeType).getBothSideFeePercent({
      currency: "USDT",
      type: "taker",
    }) / 100;
  const detectedVPoints: Record<string, VolatilityPoint[]> = {};
  const history: Position[] = [];
  const growthByTime = new Map<number, RuntimeQuickBacktestGrowthPoint>();
  let clockTime = startTime;

  /** Records one equity snapshot; later snapshots at the same time win. */
  const snapshot = (timeMs: number) => {
    const balance = state.balance[accountSlug];
    if (!balance || !Number.isFinite(timeMs)) return;

    const { floatingUsdt, openNotionalUsdt } = getOpenPositionExposure(
      state,
      accountSlug,
      roundTripFeeRatio,
    );

    growthByTime.set(Math.floor(timeMs / 1000) * 1000, {
      timeMs,
      currentAsset: balance.total,
      currentAssetFloating: balance.total + floatingUsdt,
      currentBalance: balance.available,
      currentBaseAsset: openNotionalUsdt,
      currentReservedBalance: balance.reserved,
      currentSafeHaven: balance.safeHaven,
      currentSpendableBalance: balance.spendable,
    });
  };
  snapshot(startTime);

  const adapter: RuntimeEngineAdapter = {
    clock: {
      advanceTo(time) {
        clockTime = Math.min(time, endTime);
        snapshot(clockTime);
      },
      finished() {
        return clockTime >= endTime;
      },
      now() {
        return clockTime;
      },
    },
    market: {
      getKlines: dataset.getKlines,
    },
    exchange: {
      getFeeRate({ side, type }) {
        return (
          getFeeCalculator(config.management.exchangeType)
            .getTotalFeePercent({ currency: "USDT", side, type }) / 100
        );
      },
      getRoundTripFeeRate({ type }) {
        return (
          getFeeCalculator(config.management.exchangeType)
            .getBothSideFeePercent({ currency: "USDT", type }) / 100
        );
      },
    },
    onStrategy: async (decision, context) => {
      // BTEST:STOP_AUTO_ENTRY_BEFORE_END
      if (
        decision.type === "entry" &&
        context.state.currentTime >= entryCutoffTime
      ) {
        return false;
      }
      return true;
    },
    onAction: async (decision, context) => {
      if (decision.type === "entry") {
        return entryAction.execute(context, decision);
      }
      if (decision.type === "averaging") {
        return tradingAveraging.execute(context, decision);
      }
      if (decision.type === "exit") {
        return tradingExit.execute(context, decision);
      }
      return null;
    },
    onExit: async (position) => {
      history.push(position);
      snapshot(state.currentTime);
    },
    onNewVPoint: async (symbol, newVPoint) => {
      (detectedVPoints[symbol] ??= []).push(newVPoint);
    },
    onStateChange: async () => {
      snapshot(state.currentTime);
    },
    onNotif: () => false,
  };

  const engine = new RuntimeEngine(state, adapter);
  await engine.start();
  snapshot(endTime);

  const closedPositions = [...history];
  const positionsBySymbol = Object.fromEntries(
    symbols.map((symbol) => [
      symbol,
      closedPositions.filter(
        (position) => position.symbol.toUpperCase() === symbol,
      ),
    ]),
  );
  const resultVPointsMap = Object.fromEntries(
    [
      ...new Set([
        ...Object.keys(initialVPointsMap),
        ...Object.keys(detectedVPoints),
      ]),
    ].map((symbol) => [
      symbol,
      vpoints.mergeById(
        initialVPointsMap[symbol] ?? [],
        detectedVPoints[symbol] ?? [],
      ),
    ]),
  );
  const growth = [...growthByTime.values()].sort(
    (left, right) => left.timeMs - right.timeMs,
  );

  const finalPortfolioValue =
    quickBacktestReport.metrics.portfolioValue(growth.at(-1)) ||
    state.balance[accountSlug].total + state.balance[accountSlug].safeHaven;
  const gainUsdt = finalPortfolioValue - startingBalanceUSDT;
  const gainPct =
    startingBalanceUSDT > 0 ? (gainUsdt / startingBalanceUSDT) * 100 : 0;
  const firstTime = growth[0]?.timeMs ?? startTime;
  const lastTime = growth.at(-1)?.timeMs ?? endTime;
  const weeks = Math.max(1, (lastTime - firstTime) / (7 * 24 * 60 * 60 * 1000));
  const entryCount = closedPositions.length;

  return {
    metrics: {
      entryCount,
      sharpeRatio: quickBacktestReport.metrics.sharpeRatio(growth),
      gainPct,
      gainUsdt,
      finalUsdt: finalPortfolioValue,
      avgProfitUsdtPerWeek: gainUsdt / weeks,
      ...quickBacktestReport.metrics.positions({
        positionsBySymbol,
        volatilityMap: resultVPointsMap,
      }),
      ...quickBacktestReport.metrics.unusedCapital(growth),
    },
    tradeHistory: quickBacktestReport.tradeHistory(
      positionsBySymbol,
      resultVPointsMap,
    ),
    growthOvertimeSeries: quickBacktestReport.growthSeries(growth),
    simulationSeries:
      quickBacktestReport.simulationSeries(positionsBySymbol),
  };
}

/** Runs every enabled account and combines their trades into one report. */
async function run(
  input: RuntimeQuickBacktestInput,
): Promise<RuntimeQuickBacktestResult> {
  const enabledAccounts = (input.accounts ?? []).filter(
    (account) => account.enabled,
  );
  if (input.accounts && enabledAccounts.length === 0) {
    throw new Error("Enable at least one account before running Quick Backtest.");
  }
  if (enabledAccounts.length === 0) {
    return runSingle({
      flatConfig: input.config,
      input,
      startAmount: input.startAmount,
    });
  }

  const accountResults: Array<{
    name: string;
    startAmount: number;
    result: RuntimeQuickBacktestResult;
  }> = [];
  // BTEST:MULTI_ACCOUNT_COMBINED_BACKTEST
  for (const account of enabledAccounts) {
    accountResults.push({
      name: account.name || account.slug,
      startAmount: account.startAmount,
      result: await runSingle({
        accountName: account.name || account.slug,
        accountSlug: account.slug,
        flatConfig: account.config,
        input,
        startAmount: account.startAmount,
      }),
    });
  }

  const metrics = accountResults.map((account) => account.result.metrics);
  const startingUsdt = accountResults.reduce(
    (total, account) => total + account.startAmount,
    0,
  );
  const finalUsdt = metrics.reduce((total, item) => total + item.finalUsdt, 0);
  const gainUsdt = finalUsdt - startingUsdt;
  const entryCount = metrics.reduce((total, item) => total + item.entryCount, 0);
  const totalHoldDurationMs = metrics.reduce(
    (total, item) => total + item.totalHoldDurationMs,
    0,
  );
  const totalActiveCapitalDurationMs = metrics.reduce(
    (total, item) => total + item.totalActiveCapitalDurationMs,
    0,
  );
  const totalUnusedCapitalDurationMs = metrics.reduce(
    (total, item) => total + item.totalUnusedCapitalDurationMs,
    0,
  );
  const { formatDuration } = quickBacktestReport;
  const minPositive = (values: number[]) => {
    const positive = values.filter((value) => value > 0);
    return positive.length > 0 ? Math.min(...positive) : 0;
  };

  return {
    metrics: {
      entryCount,
      sharpeRatio:
        entryCount > 0
          ? metrics.reduce(
              (total, item) => total + item.sharpeRatio * item.entryCount,
              0,
            ) / entryCount
          : 0,
      gainPct: startingUsdt > 0 ? (gainUsdt / startingUsdt) * 100 : 0,
      gainUsdt,
      finalUsdt,
      avgProfitUsdtPerWeek: metrics.reduce(
        (total, item) => total + item.avgProfitUsdtPerWeek,
        0,
      ),
      maxPositionDrawdownPct: Math.max(
        0,
        ...metrics.map((item) => item.maxPositionDrawdownPct),
      ),
      minHoldDurationMs: minPositive(
        metrics.map((item) => item.minHoldDurationMs),
      ),
      totalHoldDurationMs,
      avgHoldDurationMs: entryCount > 0 ? totalHoldDurationMs / entryCount : 0,
      maxHoldDurationMs: Math.max(
        0,
        ...metrics.map((item) => item.maxHoldDurationMs),
      ),
      minHoldDuration: formatDuration(
        minPositive(metrics.map((item) => item.minHoldDurationMs)),
      ),
      totalHoldDuration: formatDuration(totalHoldDurationMs),
      avgHoldDuration: formatDuration(
        entryCount > 0 ? totalHoldDurationMs / entryCount : 0,
      ),
      maxHoldDuration: formatDuration(
        Math.max(0, ...metrics.map((item) => item.maxHoldDurationMs)),
      ),
      minActiveCapitalDurationMs: minPositive(
        metrics.map((item) => item.minActiveCapitalDurationMs),
      ),
      totalActiveCapitalDurationMs,
      avgActiveCapitalDurationMs:
        totalActiveCapitalDurationMs / accountResults.length,
      maxActiveCapitalDurationMs: Math.max(
        0,
        ...metrics.map((item) => item.maxActiveCapitalDurationMs),
      ),
      minActiveCapitalDuration: formatDuration(
        minPositive(metrics.map((item) => item.minActiveCapitalDurationMs)),
      ),
      totalActiveCapitalDuration: formatDuration(totalActiveCapitalDurationMs),
      avgActiveCapitalDuration: formatDuration(
        totalActiveCapitalDurationMs / accountResults.length,
      ),
      maxActiveCapitalDuration: formatDuration(
        Math.max(0, ...metrics.map((item) => item.maxActiveCapitalDurationMs)),
      ),
      minUnusedCapitalDurationMs: minPositive(
        metrics.map((item) => item.minUnusedCapitalDurationMs),
      ),
      totalUnusedCapitalDurationMs,
      avgUnusedCapitalDurationMs:
        totalUnusedCapitalDurationMs / accountResults.length,
      maxUnusedCapitalDurationMs: Math.max(
        0,
        ...metrics.map((item) => item.maxUnusedCapitalDurationMs),
      ),
      minUnusedCapitalDuration: formatDuration(
        minPositive(metrics.map((item) => item.minUnusedCapitalDurationMs)),
      ),
      totalUnusedCapitalDuration: formatDuration(totalUnusedCapitalDurationMs),
      avgUnusedCapitalDuration: formatDuration(
        totalUnusedCapitalDurationMs / accountResults.length,
      ),
      maxUnusedCapitalDuration: formatDuration(
        Math.max(0, ...metrics.map((item) => item.maxUnusedCapitalDurationMs)),
      ),
    },
    tradeHistory: accountResults
      .flatMap((account) => account.result.tradeHistory)
      .sort((left, right) => (right.closed?.t ?? 0) - (left.closed?.t ?? 0)),
    growthOvertimeSeries:
      quickBacktestReport.combineGrowthSeries(accountResults),
    simulationSeries:
      quickBacktestReport.combineSimulationSeries(accountResults),
  };
}

const runtimeQuickBacktest = {
  run,
  report: quickBacktestReport,
} as const;

export default runtimeQuickBacktest;
export { runtimeQuickBacktest };
export type {
  RuntimeQuickBacktestAccountInput,
  RuntimeQuickBacktestGrowthPoint,
  RuntimeQuickBacktestInput,
  RuntimeQuickBacktestMarker,
  RuntimeQuickBacktestMetrics,
  RuntimeQuickBacktestResult,
} from "./types";
