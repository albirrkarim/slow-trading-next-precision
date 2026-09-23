import type {
  RuntimeAccountConfig,
  RuntimeBlackSwanState,
  RuntimeDashboardRuntimeConfig,
  RuntimeEffectiveConfig,
  RuntimeMode,
} from "../runtime/types";
import type {
  RuntimeCyclePerformanceSummary,
  RuntimeStageRunStatsMap,
} from "../runtime/stages";
import type { RuntimeBinanceHealthSnapshot } from "../storage/logs";
import type { RuntimeHistoryPosition } from "../trading/types";

/** Balance summary rendered by the dashboard for one account/mode. */
export interface RuntimeDashboardBalances {
  /** Quote asset available before reserve subtraction. */
  availableQuoteAsset: number;
  /** Quote asset reserved for watch/averaging steps. */
  reservedQuoteAsset: number;
  /** Quote asset available after reserve subtraction. */
  spendableQuoteAsset: number;
  /** Safe Haven balance separated from trading capital. */
  safeHaven: number;
  /** Total margin locked by active open positions. */
  lockedQuoteAsset: number;
  /** Initial balance used as the mode baseline. */
  startingBalanceUSDT: number;
}

/** Account identity, execution mode, and balances shown in combined UI chrome. */
export interface RuntimeDashboardAccountSummary {
  slug: string;
  name: string;
  enabled: boolean;
  activeMode: RuntimeMode;
  balances: RuntimeDashboardBalances;
}

/** Dashboard response shape for the active runtime mode. */
export interface RuntimeDashboardState {
  /** Latest successful public instance-IP check, when available. */
  instanceIp?: {
    ip: string;
    t: number;
  };
  /** Null for the default combined dashboard, otherwise the filtered account. */
  accountFilter: string | null;
  /** Every saved account profile, exposed for client-side account selection. */
  accounts: RuntimeAccountConfig[];
  /** Per-account balances retained even when the default view is combined. */
  accountSummaries: RuntimeDashboardAccountSummary[];
  /** Currently selected runtime mode. */
  activeMode: RuntimeMode;
  /** Global process-level strategy values resolved by the server. */
  globalConfig: {
    /** Percentage move required to activate volatility detection. */
    volatilityThresholdPct: number;
  };
  /** Flat strategy configuration rendered by the dashboard. */
  config: RuntimeEffectiveConfig;
  /** Runtime controls rendered by the dashboard. */
  runtime: RuntimeDashboardRuntimeConfig;
  /** Current persisted portfolio-wide protection status and evidence. */
  blackSwan: RuntimeBlackSwanState;
  /** Current and historical Binance REST cooldown health. */
  binanceHealth?: RuntimeBinanceHealthSnapshot;
  /** Balance summary for the active mode. */
  balances: RuntimeDashboardBalances;
  /** Closed/history positions for the active mode. */
  history: RuntimeHistoryPosition[];
  /** Open positions for the active mode. */
  openPositions: RuntimeHistoryPosition[];
  /** Dashboard summary statistics. */
  stats: {
    /** Number of closed trade rows. */
    closedTrades: number;
    /** Number of currently open positions. */
    openPositions: number;
    /** Last completed cycle timestamp in milliseconds. */
    lastRunAt?: number;
    /** Last completed cycle duration in milliseconds. */
    lastRunDurationMs?: number;
    /** Last completed cycle summary shown in the UI. */
    lastRunSummary?: string;
    /** Last completed cycle section-duration summary. */
    lastRunPerformance?: RuntimeCyclePerformanceSummary;
    /** Latest successful run statistics retained separately for each stage. */
    stageRuns: RuntimeStageRunStatsMap;
    /** Last time the monthly Safe Haven scheduler handled a UTC month. */
    safeHavenLastScheduledAt?: number;
  };
}

/** Options controlling the realtime dashboard enrichment passes. */
export interface RuntimeDashboardRealtimeOptions {
  /** Overrides the active catalog mode when reading persisted state. */
  mode?: RuntimeMode;
  /** Set false when a caller must use the persisted balance. */
  refreshLiveBalance?: boolean;
}
