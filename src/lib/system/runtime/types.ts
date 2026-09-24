import type {
  LevelBasedPctDriftStopLossConfig,
  PostAverageRescueExitConfig,
  PostAverageStopLossConfig,
} from "../trading";
import type {
  BlackSwanConfig,
  BlackSwanState,
} from "../trading/black-swan";
import type { ExchangeAccountSlug } from "@/lib/exchange/account-context";
import type {
  DashboardNotificationConfig,
  NotificationRouteConfig,
  NotificationTypeConfig,
} from "../notification/config";
import type { ExchangeType } from "../types/market";
import type { TradingMode } from "@/lib/exchange/types";

/** Execution mode persisted per account slice. */
export type RuntimeMode = "live" | "sandbox";

/** Per-channel notification routing persisted in the runtime config. */
export type RuntimeNotificationTypeConfig = NotificationTypeConfig;

/** One dashboard notification channel route. */
export type RuntimeNotificationRouteConfig = NotificationRouteConfig;

/** Dashboard notification routing configuration. */
export type RuntimeNotificationConfig = DashboardNotificationConfig;

/** Saved withdrawal destination wallet. */
export interface RuntimeWithdrawalWallet {
  id: string;
  name: string;
  network: string;
  address: string;
}

/** Recurring or manually runnable withdrawal schedule. */
export interface RuntimeWithdrawalSchedule {
  id: string;
  account: ExchangeAccountSlug;
  name: string;
  enabled: boolean;
  amountUSDT: number;
  dayOfMonth: number;
  walletId?: string;
  targetNetwork: string;
  targetWalletAddress: string;
  lastAttemptAt?: number;
  lastSuccessAt?: number;
  lastQueuedAt?: number;
  lastStatus?: string;
}

/** Withdrawal runtime settings stored under the runtime config. */
export interface RuntimeWithdrawalConfig {
  autoEnabled: boolean;
  schedules: RuntimeWithdrawalSchedule[];
  walletBook: RuntimeWithdrawalWallet[];
}

/** Recurring request that moves trading capital into the virtual Safe Haven. */
export interface RuntimeSafeHavenSchedule {
  id: string;
  name: string;
  enabled: boolean;
  amountUSDT: number;
  pct: number;
  dayOfMonth: number;
  lastQueuedAt?: Partial<Record<RuntimeMode, number>>;
}

/** Safe Haven recurring schedule settings stored under the runtime config. */
export interface RuntimeSafeHavenConfig {
  autoEnabled: boolean;
  schedules: RuntimeSafeHavenSchedule[];
}

/** One permission flag available to an MCP token. */
export type RuntimeMcpPermission =
  | "tags.read"
  | "tags.write"
  | "coin_metadata.read"
  | "coin_metadata.write"
  | "coin_metadata.broadcast"
  | "balance.read"
  | "trade_history.read"
  | "monitoring.read"
  | "engine_state.read";

/** Persisted MCP token record. Secrets are stored only as hashes plus encrypted reveal data. */
export interface RuntimeMcpTokenRecord {
  id: string;
  name: string;
  enabled: boolean;
  permissions: RuntimeMcpPermission[];
  tokenHash: string;
  tokenSecretEncrypted: string;
  createdAt: number;
  lastUsedAt?: number;
}

/** MCP token fields safe for dashboard/API responses. */
export type RuntimeMcpPublicTokenRecord = Omit<
  RuntimeMcpTokenRecord,
  "tokenHash" | "tokenSecretEncrypted"
> & {
  secretAvailable: boolean;
};

/** Runtime MCP connector config stored with the persisted settings. */
export interface RuntimeMcpConfig {
  tokens: RuntimeMcpTokenRecord[];
}

/** Runtime MCP config safe for dashboard/API responses. */
export interface RuntimeMcpDashboardConfig {
  tokens: RuntimeMcpPublicTokenRecord[];
}

/** Portfolio crash-protection thresholds shared by every account. */
export type RuntimeBlackSwanConfig = BlackSwanConfig;

/** Persisted, per-mode portfolio protection state. */
export type RuntimeBlackSwanState = BlackSwanState;

/** Account-owned strategy settings consumed by the runtime engine. */
export interface RuntimeAccountTradingConfig {
  maxOpenPositions?: number;
  minActionableAbsoluteLevel?: number;
  takeProfitPercent: number;
  useStopLossPlus?: boolean;
  enableWatchLogic?: boolean;
  adaptiveAveraging?: {
    enabled: boolean;
    maxMultiplier: number;
    minProjectedProfitPct: number;
  };
  averagingRescueProjectionGuardEnabled?: boolean;
  entrySpareBufferEnabled?: boolean;
  maxEntryBased24HourVolPct?: number;
  maxEntryMargin?: number;
  maxEntryMarginPct?: number;
  watchMaxNextAveragingLevels?: number;
  watchReserveLevels?: number;
  watchReservePctAlloc?: number;
  exactLeverage?: number;
  maxLeverage?: number;
  orderType?: "maker" | "taker";
  exitOnVPointAbsLevel?: number;
  stopLossUSDT?: number;
  stopLossPercent?: number;
  volatilityTargetStopLossPercent?: number;
  postAverageRescueExit?: PostAverageRescueExitConfig;
  postAverageStopLoss?: PostAverageStopLossConfig;
  levelBasedPctDriftStopLoss?: LevelBasedPctDriftStopLossConfig;
  stopLossPlusTrigger?: number;
  maxHoldMinutes?: number;
  balanceUSDT?: number;
  maxRiskPercent?: number;
  dcaMultiplier?: number;
  dcaDipPercent?: number;
  maxDcaRounds?: number;
  confidenceBase?: number;
  maxBuyUSDT?: number;
  onlyTPFromDate?: string;
  /** Entries in live, sandbox, and backtest enforce the vPoint price-drift guard. */
  lateEntryVPointPriceDriftEnabled?: boolean;
  /** User-authored reminder describing this account's trading strategy. */
  notes: string;
}

/** Exchange credentials persisted for one runtime account. */
export interface RuntimeAccountCredentials {
  apiKey: string;
  apiSecret: string;
  passphrase?: string;
}

/** Runtime-visible account profile. */
export interface RuntimeAccountConfig {
  slug: string;
  name: string;
  type: ExchangeType;
  description: string;
  credentials: RuntimeAccountCredentials;
  enabled: boolean;
  trading: RuntimeAccountTradingConfig;
  sandbox: {
    initialBalanceUSDT: number;
  };
  createdAt: number;
  updatedAt: number;
}

/** Shared management/strategy configuration for the runtime engine. */
export interface RuntimeManagementConfig {
  name: string;
  description: string;
  symbols: string[];
  tradingMode: TradingMode;
  exchangeType: ExchangeType;
  decisionEngineVersion?: string;
  /** Portfolio crash-protection thresholds shared by every account. */
  blackSwan?: RuntimeBlackSwanConfig;
  /** Monthly safe-haven targets shared by every account. */
  safePercentPerMonth?: number;
  safeUSDTPerMonth?: number;
  /** Minimum trading capital that must remain after safe-haven moves. */
  minimalAssetOnTrade?: number;
}

/** Global runtime controls shared by every runtime environment. */
export interface RuntimeControlConfig {
  runnerEnabled: boolean;
  autoEntryEnabled: boolean;
  autoExitEnabled: boolean;
  entrySignalBypass: boolean;
  pnlHistoryBucketMinutes: number;
  blackSwanStageIntervalMinutes: number;
  managementStageIntervalMinutes: number;
  speedupStageIntervalMinutes: number;
  standardMonitoringStageIntervalMinutes: number;
  captureEntryStageIntervalMinutes: number;
  speedupStageNegativePnlThresholdPct: number;
  speedupStagePositivePnlThresholdPct: number;
  speedupStageTakeProfitOffsetPct: number;
  /** When enabled, every enabled account simulates orders locally. */
  sandboxEnabled: boolean;
  /** Stops automatic entries when current UTC-day net PnL reaches this USDT value. */
  autoEntryDailyPnlLimitUSDT: number;
  /** Auto-removes configured symbols when vpoints reach this absolute level; 0 disables. */
  autoRemoveSymbolAbsLevel: number;
  /** Auto-removes configured symbols and blocks entries below this market price; 0 disables. */
  autoRemoveSymbolMinPrice: number;
  /** Auto-removes configured symbols below this USD market cap; 0 disables. */
  autoRemoveSymbolMinMarketCapUSD: number;
  /** Auto-removes configured symbols when any stored vPoint reaches this percent; 0 disables. */
  autoRemoveSymbolMinVPointPct: number;
  /** Dashboard notification routing configuration. */
  notification: RuntimeNotificationConfig;
  /** Withdrawal wallet book and recurring schedule config. */
  withdrawal: RuntimeWithdrawalConfig;
  /** Safe Haven recurring schedule config. */
  safeHaven: RuntimeSafeHavenConfig;
  /** MCP connector authentication and per-token permissions. */
  mcp: RuntimeMcpConfig;
}

/** Canonical runtime configuration consumed by the shared runtime engine. */
export interface RuntimeConfig {
  management: RuntimeManagementConfig;
  runtime: RuntimeControlConfig;
  accounts: RuntimeAccountConfig[];
}

/**
 * Flat strategy view rendered by the dashboard: shared management settings
 * overlaid with one account's trading overrides.
 */
export type RuntimeEffectiveConfig = RuntimeManagementConfig &
  Omit<RuntimeAccountTradingConfig, "notes"> & {
    /** User-authored account strategy note; lives on `account.trading.notes`. */
    notes?: string;
  };

/** Canonical grouped settings payload shared by persistence and the settings dialog. */
export interface RuntimeSettingsConfig {
  management: RuntimeManagementConfig;
  runtime: RuntimeDashboardRuntimeConfig;
  accounts: RuntimeAccountConfig[];
}

/**
 * Runtime controls rendered by the dashboard (MCP secrets stripped).
 * Declared explicitly because `Omit` collapses index-signature bases to `unknown`.
 */
export interface RuntimeDashboardRuntimeConfig {
  runnerEnabled: boolean;
  autoEntryEnabled: boolean;
  autoExitEnabled: boolean;
  entrySignalBypass: boolean;
  pnlHistoryBucketMinutes: number;
  blackSwanStageIntervalMinutes: number;
  managementStageIntervalMinutes: number;
  speedupStageIntervalMinutes: number;
  standardMonitoringStageIntervalMinutes: number;
  captureEntryStageIntervalMinutes: number;
  speedupStageNegativePnlThresholdPct: number;
  speedupStagePositivePnlThresholdPct: number;
  speedupStageTakeProfitOffsetPct: number;
  sandboxEnabled: boolean;
  autoEntryDailyPnlLimitUSDT: number;
  autoRemoveSymbolAbsLevel: number;
  autoRemoveSymbolMinPrice: number;
  autoRemoveSymbolMinMarketCapUSD: number;
  autoRemoveSymbolMinVPointPct: number;
  notification: RuntimeNotificationConfig;
  withdrawal: RuntimeWithdrawalConfig;
  safeHaven: RuntimeSafeHavenConfig;
  mcp?: RuntimeMcpDashboardConfig;
  [key: string]: unknown;
}
