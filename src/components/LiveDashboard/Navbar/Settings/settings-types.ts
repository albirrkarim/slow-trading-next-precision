"use client";

import type { AdaptiveAveragingConfig } from "@/lib/dynamic";
import type { ExchangeType, TradingMode } from "@/lib/exchange/types";
import type { DashboardNotificationConfig } from "@/lib/notification/config";
import type {
  SlowTradingAccount,
  SlowTradingAccountTradingConfig,
  SlowTradingRuntimeConfig,
} from "@/lib/slowTrading";
import type { BlackSwanConfig } from "@/lib/trading/black-swan";
import type { TradingModelConfig } from "@/lib/trading/models";
import type { Dispatch, SetStateAction } from "react";

export type { DashboardState } from "../navbar-types";

export interface WithdrawalWalletDraft {
  id: string;
  name: string;
  network: string;
  address: string;
}

export interface WithdrawalScheduleDraft {
  id: string;
  account: string;
  name: string;
  enabled: boolean;
  amountUSDT: string;
  dayOfMonth: string;
  walletId: string;
  targetNetwork: string;
  targetWalletAddress: string;
  lastAttemptAt?: number;
  lastSuccessAt?: number;
  lastQueuedAt?: number;
  lastStatus?: string;
}

export interface SafeHavenScheduleDraft {
  id: string;
  name: string;
  enabled: boolean;
  amountUSDT: string;
  pct: string;
  dayOfMonth: string;
  lastQueuedAt?: Partial<Record<"live" | "sandbox", number>>;
}

export interface ManagementConfig {
  name: string;
  description: string;
  decisionEngineVersion: string;
  exchangeAccountSlug: string;
  exchangeAccounts: SlowTradingAccount[];
  exchangeType: ExchangeType;
  tradingMode: TradingMode;
  symbolsText: string;
}

interface WithdrawConfig {
  withdrawalAutoEnabled: boolean;
  withdrawalSchedules: WithdrawalScheduleDraft[];
  withdrawalWalletBook: WithdrawalWalletDraft[];
}

interface SafeHavenConfig {
  safeHavenUSDT: string;
  safeHavenAutoEnabled?: boolean;
  safeHavenSchedules?: SafeHavenScheduleDraft[];
  minimalAssetOnTrade?: number;
}

export interface ConfigDraft
  extends
    ManagementConfig,
    SlowTradingAccountTradingConfig,
    SlowTradingRuntimeConfig,
    WithdrawConfig,
    SafeHavenConfig {
  blackSwan?: BlackSwanConfig;

  // lateEntryVPointPriceDriftEnabled?: boolean;
  // modelConfig: TradingModelConfig;
  // runnerEnabled: boolean;
  // autoEntryEnabled: boolean;
  // autoEntryDailyPnlLimitUSDT?: number;
  // autoExitEnabled: boolean;
  // entrySignalBypass: boolean;
  // autoRemoveSymbolAbsLevel: number;
  // autoRemoveSymbolMinMarketCapUSD?: number;
  // autoRemoveSymbolMinPrice?: number;
  // autoRemoveSymbolMinVPointPct?: number;
  // pnlHistoryBucketMinutes?: number;
  // speedupStageIntervalMinutes?: number;
  // speedupStagePositivePnlThresholdPct?: number;
  // speedupStageNegativePnlThresholdPct?: number;
  // speedupStageTakeProfitOffsetPct?: number;
  // standardMonitoringStageIntervalMinutes?: number;
  // managementStageIntervalMinutes?: number;
  // captureEntryStageIntervalMinutes?: number;
  // notification: DashboardNotificationConfig;
  // sandboxEnabled: boolean;
  // sandboxInitialBalanceUSDT: string;
  // enableWatchLogic?: boolean;
  // entrySpareBufferEnabled?: boolean;
  // watchReserveLevels?: number;
  // watchMaxNextAveragingLevels?: number;
  // watchReservePctAlloc?: number;
  // adaptiveAveraging?: AdaptiveAveragingConfig;
  // averagingRescueProjectionGuardEnabled?: boolean;
  // exitSidewaysToFreeWorkersForStrongCandidates?: boolean;
  // maxEntryMarginPct?: number;
  // maxEntryBased24HourVolPct?: number;
  // maxEntryMargin?: number;
  // maxOpenPositions?: number;
  // minActionableAbsoluteLevel?: number;
  // maxLeverage?: number;
  // exactLeverage?: number;
}

export type ConfigDraftSetter = Dispatch<SetStateAction<ConfigDraft | null>>;

export interface OpenPositionSummary {
  totalPnlUSDT: number;
  avgPnlPercent: number;
  lockedCapitalUSDT: number;
}

export interface DayPreviewSummary {
  dailyUsdtProfit: number;
  dailyPnlPercentSum: number;
}

export interface BalanceSummary {
  available: number;
  reserved: number;
  spendable: number;
  safeHaven: number;
  startingBalance: number;
  locked: number;
  total: number;
}
