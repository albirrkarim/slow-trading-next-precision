import type { FetchKlines, VolatilityPoint } from "@/lib/system/types";
import type {
  AveragingRecommendation,
  BalanceSummary,
  EntryRecommendation,
  Position,
  PositionDirection,
  TradeDecision,
} from "@/lib/system/trading";
import type {
  RuntimeAccountConfig,
  RuntimeAccountTradingConfig,
  RuntimeConfig,
  RuntimeStage,
  RuntimeStageRunStats,
} from "@/lib/system/runtime";

export type RuntimeMarketInterval = "1m" | "5m";

export interface RuntimeMarketHelper {
  updateMarkPrice(interval?: RuntimeMarketInterval): Promise<void>;
  updateVPointsMap(interval?: RuntimeMarketInterval): Promise<void>;
}

/** State-bound account, balance, configuration, and market helpers. */
export interface RuntimeHelper {
  getAccount(accountSlug: string): RuntimeAccountConfig;
  getAccountBalance(accountSlug: string): BalanceSummary;
  getAccountConfig(
    accountSlug: string,
  ): RuntimeAccountTradingConfig;
  market: RuntimeMarketHelper;
}

// Pack of market function
interface MarketFunction {
  getKlines: FetchKlines;
}

/**
 * Exchange capabilities the shared runtime consumes. Fee rates are returned
 * as decimal ratios: `0.001` means `0.1%`, and a round-trip rate is the
 * combined entry + exit fee.
 */
export interface RuntimeExchangePort {
  /**
   * Not needed in backtest
   */
  getBalance?: (
    accountSlug?: string,
  ) => number | Promise<number>;

  /** Single-side order fee as a decimal ratio. */
  getFeeRate(params: {
    side: "buy" | "sell";
    type: "maker" | "taker";
  }): number;

  /** Round-trip (entry + exit) fee as a decimal ratio. */
  getRoundTripFeeRate(params: {
    type: "maker" | "taker";
  }): number;
}

/**
 * Environment clock used by the shared runtime scheduler.
 *
 * Backtests advance logical time immediately, while production waits for the
 * requested wall-clock boundary.
 */
export interface RuntimeClock {
  /** Advances or waits until the requested Unix timestamp in milliseconds. */
  advanceTo(time: number): Promise<void> | void;
  /** Reports whether the runtime should stop scheduling additional stages. */
  finished(): Promise<boolean> | boolean;
  /** Returns the clock's current canonical Unix timestamp in milliseconds. */
  now(): number;
}

export interface RuntimeEngineState {
  /**
   * Global time for the backtest
   */
  currentTime: number;

  /**
   * Production: live/sandbox
   * Backtest: precision backtest
   */
  mode: "live" | "sandbox" | "backtest";

  openPositions: Position[];

  /**
   * All config
   */
  config: RuntimeConfig;

  /**
   * Balance info per account slug
   */
  // BOTH:MULTI_ACCOUNT_PRIVATE_STATE_ISOLATION — account-owned balance is
  // keyed by slug and never shared across accounts.
  balance: Record<string, BalanceSummary>;

  /**
   * {
   *    "SUI": []
   *    "BTC": []
   * }
   */
  vPointsMap: Record<string, VolatilityPoint[]>;

  /**
   * {
   *    "SUI":{
   *     lastUpdated:0,
   *      price:0
   *    }
   * }
   */
  markPriceMap: Record<
    string,
    {
      // unix
      lastUpdated: number;
      // coing price
      price: number;
    }
  >;

  /**
   * Optional 24h quote volume per base symbol, used to cap entry margin via
   * `maxEntryBased24HourVolPct`. Backtests seed it from caller-provided
   * volume maps; production leaves it unset until a live feed lands.
   */
  volume24hMap?: Record<string, number>;
}

/**
 * Approved entry candidate produced by the shared decision pipeline.
 */
export interface RuntimeEntryDecision {
  type: "entry";
  accountSlug: string;
  direction: PositionDirection;
  entrySignal: EntryRecommendation;
  /** Operator-forced entry: bypasses the auto-entry runtime gate. */
  manual?: boolean;
  message: string;
  symbol: string;
  /**
   * Strategy-owned usage markers written onto the source vPoint after the
   * entry fills. Defaults to `[accountSlug]`; pair strategies emit
   * `"<slug>:<ROLE>"` markers instead.
   */
  vPointUsage?: string[];
}

/**
 * Averaging candidate for an existing open position.
 */
export interface RuntimeAveragingDecision {
  type: "averaging";
  accountSlug: string;
  message: string;
  position: Position;
  recommendation: AveragingRecommendation;
  symbol: string;
  /**
   * Strategy-owned usage markers written onto the consumed vPoint after the
   * fill. Defaults to `[accountSlug]`; strategies may emit per-leg markers
   * or none at all.
   */
  vPointUsage?: string[];
}

/**
 * Exit candidate for an existing open position.
 */
export interface RuntimeExitDecision {
  type: "exit";
  accountSlug: string;
  message: string;
  position: Position;
  symbol: string;
  tradeDecision: TradeDecision;
}

export type RuntimeDecision =
  | RuntimeEntryDecision
  | RuntimeAveragingDecision
  | RuntimeExitDecision;

/** Opaque strategy-owned volatility detector memory. */
export interface RuntimeVPointMemory {
  readonly value: unknown;
}

/**
 * We will have Backend adapter and production adapter
 */
export interface RuntimeEngineAdapter {
  /** Environment clock: instant in backtest, real-time in production. */
  clock: RuntimeClock;

  /**
   * Getting the market data
   */
  market: MarketFunction;

  /**
   * we pass the exchange lib so it can later be tested outside
   * does it really called the update balance after doing some action
   */
  exchange: RuntimeExchangePort;

  /**
   * Bounds how many recent vPoints `state.vPointsMap` keeps per symbol after
   * each market update; older points survive only while an open position
   * still references them. Defaults to `DEFAULT_RECENT_VPOINTS`. Set
   * `Number.POSITIVE_INFINITY` to retain the full detected history.
   */
  retainRecentVPoints?: number;

  /**
   * Called once for every newly detected vPoint, in chronological order,
   * before the retention trim. Production persists points into the shared
   * volatility files so restarts resume from fresh data; backtests can buffer
   * them to reconstruct the full result map while the runtime window stays
   * bounded like production.
   */
  onNewVPoint?: (
    symbol: string,
    newVPoint: VolatilityPoint,
  ) => Promise<void>;

  /**
   * with the strategy outside we can doing manythings
   * adapt to our 3 instance (multi, hedge, both)
   *
   * so the sequence will be like
   *
   * common entry signal by default runtime engine and current config
   * then approved by this onStrategy function.
   *
   * Its the final gate wether can actually entry, averaging, exit
   */
  onStrategy: (
    decision: RuntimeDecision,
    context: RuntimeContext,
  ) => Promise<boolean>;

  /**
   * Telling outside runtime engine initiate. some action
   * For entry, averaging, exit
   */
  onAction: (
    decision: RuntimeDecision,
    context: RuntimeContext,
  ) => Promise<Position | null>;

  /** Persists a closed position after the shared runtime updates its state. */
  onExit: (position: Position, context: RuntimeContext) => Promise<void>;

  /**
   * Persists one account's environment state after the shared runtime has
   * mutated it.
   *
   * The runtime invokes this hook in two situations:
   *
   * 1. After `onAction` has returned a position and the shared monitoring
   *    code has applied its own mutation (`state.openPositions`,
   *    `state.balance`, vPoint `usedBy` markers). Entry and averaging
   *    actions use this path.
   * 2. After each monitoring pass refreshes a still-open position's PnL
   *    history and monitoring-stage classification, so the persisted row
   *    stays realtime instead of waiting for the next trade action.
   *
   * Exit persistence is handled by `onExit`, which is called after the
   * closed position has been removed from `state.openPositions` and its
   * margin has been released. Backtest adapters can omit this hook because
   * their result is already retained in memory.
   *
   * @param context - The shared runtime context containing the updated state,
   * adapter, and helper operations.
   * @param accountSlug - The account whose open positions and balance changed.
   */
  onStateChange?: (
    context: RuntimeContext,
    accountSlug: string,
  ) => Promise<void>;

  /**
   * To send notification outside
   * Unused in backtest
   */
  onNotif: () => boolean;

  /**
   * Environment-owned risk-sentinel stage (Black Swan detection and
   * protection). Production implements evidence capture, persisted status,
   * notifications, and emergency-exit marking; backtests omit it.
   * May return stats refinements merged into the stage run record.
   */
  onRiskSentinel?: (
    context: RuntimeContext,
  ) => Promise<RuntimeStageRunPatch | void>;

  /**
   * Environment-owned management stage: balance snapshots, daily-PnL entry
   * limit evaluation, and completed-day performance reporting. Production
   * implements it over persistent storage; backtests omit it.
   */
  onManagement?: (
    context: RuntimeContext,
  ) => Promise<RuntimeStageRunPatch | void>;

  /**
   * Called after every dispatched stage with its measured run stats so the
   * environment can persist `stageRuns` records.
   */
  onStageStats?: (
    stage: RuntimeStage,
    stats: RuntimeStageRunStats,
    context: RuntimeContext,
  ) => Promise<void>;

  /**
   * Called once after all due stages in a scheduler tick finish so the
   * environment can persist the `lastRun*` cycle summary.
   */
  onCycleComplete?: (
    stats: RuntimeStageRunStats,
    context: RuntimeContext,
  ) => Promise<void>;
}

/** Optional refinements an environment-owned stage returns for its run stats. */
export interface RuntimeStageRunPatch {
  reports?: number;
  summary?: string;
  symbols?: number;
}

/** Shared dependencies and mutable state supplied to every runtime operation. */
export interface RuntimeContext {
  /** Environment-specific clock, market, exchange, execution, and output hooks. */
  adapter: RuntimeEngineAdapter;
  /** State-bound account, balance, configuration, and market helpers. */
  helper: RuntimeHelper;
  /** Canonical mutable runtime state shared by backtest and production flows. */
  state: RuntimeEngineState;
}
