import blackSwan from "../trading/black-swan";
import { TradingMode } from "@/lib/exchange/types";
import { createDefaultDashboardNotificationConfig } from "../notification/config";
import runtimeStages from "./stages";
import type {
  RuntimeAccountTradingConfig,
  RuntimeConfig,
  RuntimeControlConfig,
  RuntimeManagementConfig,
} from "./types";

export const DEFAULT_AUTO_ENTRY_DAILY_PNL_LIMIT_USDT = -50;
export const DEFAULT_AUTO_REMOVE_SYMBOL_MIN_VPOINT_PCT = 15;
export const DEFAULT_PNL_HISTORY_BUCKET_MINUTES = 60;
export const DEFAULT_SANDBOX_INITIAL_BALANCE_USDT = 1000;

/** Default shared management/strategy configuration. */
function createManagement(): RuntimeManagementConfig {
  return {
    name: "SLOW Trade",
    description: "",
    symbols: ["SUI", "SOL", "HBAR"],
    decisionEngineVersion: "decision.v14",
    exchangeType: "binance",
    tradingMode: TradingMode.SPOT,
    safePercentPerMonth: 0.1,
    minimalAssetOnTrade: 600,
    blackSwan: blackSwan.config.normalize(undefined),
  };
}

/** Default per-account trading settings seeded from the shared baseline. */
function createTrading(): RuntimeAccountTradingConfig {
  return {
    takeProfitPercent: 5,
    stopLossPercent: 20,
    exitOnVPointAbsLevel: 0,
    stopLossUSDT: 50,
    volatilityTargetStopLossPercent: 0,
    postAverageRescueExit: {
      enabled: true,
      thresholds: [
        { minAveragingCount: 1, minNetPnlPct: 0.5 },
        { minAveragingCount: 2, minNetPnlPct: 0 },
        { minAveragingCount: 3, minNetPnlPct: -0.5 },
      ],
    },
    postAverageStopLoss: {
      enabled: false,
      thresholds: [
        { maxNetPnlPct: 0, maxNetPnlUsdt: 0, minAveragingCount: 1 },
      ],
    },
    levelBasedPctDriftStopLoss: { enabled: false, conditions: [] },
    useStopLossPlus: false,
    stopLossPlusTrigger: 1,
    lateEntryVPointPriceDriftEnabled: true,
    entrySpareBufferEnabled: true,
    adaptiveAveraging: {
      enabled: true,
      maxMultiplier: 5,
      minProjectedProfitPct: 2,
    },
    averagingRescueProjectionGuardEnabled: true,
    maxOpenPositions: 0,
    maxEntryBased24HourVolPct: 0.2,
    minEntryAbsLevel: 2,
    exactLeverage: 0,
    notes: "",
  };
}

/** Default global runtime controls shared by every runtime environment. */
function createRuntime(): RuntimeControlConfig {
  return {
    runnerEnabled: false,
    autoEntryEnabled: false,
    autoEntryDailyPnlLimitUSDT: DEFAULT_AUTO_ENTRY_DAILY_PNL_LIMIT_USDT,
    autoExitEnabled: false,
    entrySignalBypass: false,
    autoRemoveSymbolAbsLevel: 0,
    autoRemoveSymbolMinMarketCapUSD: 0,
    autoRemoveSymbolMinPrice: 0,
    autoRemoveSymbolMinVPointPct: DEFAULT_AUTO_REMOVE_SYMBOL_MIN_VPOINT_PCT,
    pnlHistoryBucketMinutes: DEFAULT_PNL_HISTORY_BUCKET_MINUTES,
    blackSwanStageIntervalMinutes:
      runtimeStages.interval.defaults["risk-sentinel"],
    speedupStageIntervalMinutes: runtimeStages.interval.defaults.speedup,
    speedupStagePositivePnlThresholdPct:
      runtimeStages.speedupThreshold.defaults.positivePct,
    speedupStageNegativePnlThresholdPct:
      runtimeStages.speedupThreshold.defaults.negativePct,
    speedupStageTakeProfitOffsetPct:
      runtimeStages.speedupThreshold.defaults.takeProfitOffsetPct,
    standardMonitoringStageIntervalMinutes:
      runtimeStages.interval.defaults["standard-monitoring"],
    managementStageIntervalMinutes:
      runtimeStages.interval.defaults.management,
    captureEntryStageIntervalMinutes:
      runtimeStages.interval.defaults["capture-entry"],
    notification: createDefaultDashboardNotificationConfig("SLOW"),
    sandboxEnabled: false,
    withdrawal: { autoEnabled: false, schedules: [], walletBook: [] },
    safeHaven: { autoEnabled: false, schedules: [] },
    mcp: { tokens: [] },
  };
}

/** Default persisted runtime config for a fresh deployment. */
function createConfig(accounts: RuntimeConfig["accounts"]): RuntimeConfig {
  return {
    management: createManagement(),
    runtime: createRuntime(),
    accounts,
  };
}

/** Grouped runtime-config defaults used by storage bootstrap and settings. */
const runtimeDefaults = {
  management: { create: createManagement },
  runtime: { create: createRuntime },
  trading: { create: createTrading },
  config: { create: createConfig },
} as const;

export default runtimeDefaults;
export { runtimeDefaults };
