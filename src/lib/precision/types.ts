import type { FetchKlines, Kline, VolatilityPoint } from "@/lib/system/types";
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

/** Candle intervals the shared market preparation supports. */
export type RuntimeMarketInterval = "1m" | "5m";

/** Refreshes the shared market snapshot consumed by stage bodies. */
export interface RuntimeMarketHelper {
  /** Writes the latest close per symbol into `state.markPriceMap`. */
  updateMarkPrice(interval?: RuntimeMarketInterval): Promise<void>;
  /** Appends newly detected volatility points into `state.vPointsMap`. */
  updateVPointsMap(interval?: RuntimeMarketInterval): Promise<void>;
}

/** State-bound account, balance, configuration, and market helpers. */
export interface RuntimeHelper {
  /** Gets one configured runtime account or fails for inconsistent state. */
  getAccount(accountSlug: string): RuntimeAccountConfig;
  /** Gets the mutable in-memory balance owned by one account. */
  getAccountBalance(accountSlug: string): BalanceSummary;
  /** Gets the account-owned Trading-tab configuration. */
  getAccountConfig(
    accountSlug: string,
  ): RuntimeAccountTradingConfig;
  /** Shared market snapshot updaters. */
  market: RuntimeMarketHelper;
}

/**
 * Optional live market feed. Production wires an exchange websocket stream;
 * backtests omit it and keep answering through `getKlines`.
 *
 * Every reader falls back to `getKlines` whenever the feed returns undefined,
 * so a cold stream, a coverage gap, or a dead socket degrades to the
 * previous REST behavior instead of failing the stage.
 */
export interface RuntimeMarketFeed {
  /**
   * Marks the symbol set the feed must cover for one interval. Idempotent —
   * call it on every market update so subscriptions follow config changes.
   */
  track(symbols: string[], interval: RuntimeMarketInterval): void;

  /**
   * Latest live close price for `markPriceMap`, or undefined when the feed
   * has no fresh candle for the symbol.
   */
  markPrice(
    symbol: string,
    interval: RuntimeMarketInterval,
  ): { lastUpdated: number; price: number } | undefined;

  /**
   * Closed candles received since `openTime`, or undefined when the stream
   * buffer cannot cover the window and REST must backfill it.
   */
  closedKlines(
    symbol: string,
    interval: RuntimeMarketInterval,
    sinceOpenTime: number,
  ): Kline[] | undefined;
}

/** Pack of market functions the adapter supplies to the runtime. */
interface MarketFunction {
  /** Candle fetch used by backtests and as the production REST fallback. */
  getKlines: FetchKlines;
  /** Optional live feed; when absent every read resolves through getKlines. */
  live?: RuntimeMarketFeed;
}

/**
 * Exchange capabilities the shared runtime consumes. Fee rates are returned
 * as decimal ratios: `0.001` means `0.1%`, and a round-trip rate is the
 * combined entry + exit fee.
 */
export interface RuntimeExchangePort {
  /**
   * Latest spendable quote balance for one account. Not needed in backtest —
   * simulated balances live entirely in `state.balance`.
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

  /** Every tracked position; closed entries stay until the adapter archives them. */
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
      /** Unix ms of the candle close the price was taken from. */
      lastUpdated: number;
      /** Latest coin price in quote asset. */
      price: number;
    }
  >;

  /**
   * Optional 24h quote volume per base symbol, used to cap entry margin via
   * `maxEntryBased24HourVolPct`. Backtests seed it from the caller-provided
   * volume map; production never populates it, so the liquidity cap is
   * inactive there — the ticker-volume snapshot only feeds the dashboard UI
   * and backtest inputs, never engine state.
   */
  volume24hMap?: Record<string, number>;
}

/**
 * Approved entry candidate produced by the shared decision pipeline.
 */
export interface RuntimeEntryDecision {
  /** Discriminant identifying this decision as an entry action. */
  type: "entry";
  /** Account that owns the balance and the resulting position. */
  accountSlug: string;
  /** Long/short direction the entry opens. */
  direction: PositionDirection;
  /** Detector output that produced this candidate (level, prices, sizing). */
  entrySignal: EntryRecommendation;
  /** Operator-forced entry: bypasses the auto-entry runtime gate. */
  manual?: boolean;
  /** Human-readable reason shown in notifications and logs. */
  message: string;
  /** Base symbol being entered, e.g. `SUI`. */
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
  /** Discriminant identifying this decision as an averaging action. */
  type: "averaging";
  /** Account that owns the position and funds the added margin. */
  accountSlug: string;
  /** Human-readable reason shown in notifications and logs. */
  message: string;
  /** Open position the averaging adds to. */
  position: Position;
  /** Detector output that produced this candidate (level, sizing, reserve use). */
  recommendation: AveragingRecommendation;
  /** Base symbol of the open position. */
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
  /** Discriminant identifying this decision as an exit action. */
  type: "exit";
  /** Account that owns the closing position. */
  accountSlug: string;
  /** Human-readable reason shown in notifications and logs. */
  message: string;
  /** Open position being closed. */
  position: Position;
  /** Base symbol of the open position. */
  symbol: string;
  /** Exit evaluation output (reason, target price, full/partial close). */
  tradeDecision: TradeDecision;
}

/** Any action a stage can ask the strategy gate and adapter to execute. */
export type RuntimeDecision =
  | RuntimeEntryDecision
  | RuntimeAveragingDecision
  | RuntimeExitDecision;

/** Opaque strategy-owned volatility detector memory. */
export interface RuntimeVPointMemory {
  readonly value: unknown;
}

/**
 * Environment bridge supplied to the shared engine — one implementation for
 * the backtest, one for production live/sandbox.
 */
export interface RuntimeEngineAdapter {
  /** Environment clock: instant in backtest, real-time in production. */
  clock: RuntimeClock;

  /** Market data access: klines plus the optional live feed. */
  market: MarketFunction;

  /**
   * Exchange capabilities passed as a port so they stay testable outside the
   * runtime — e.g. verifying balance refreshes around order actions.
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
   * Final strategy gate before an action executes. The shared engine builds a
   * default decision from the runtime snapshot and config; this hook approves
   * or rejects it so outer strategies (multi, hedge, both) can adapt behavior
   * without forking the engine.
   */
  onStrategy: (
    decision: RuntimeDecision,
    context: RuntimeContext,
  ) => Promise<boolean>;

  /**
   * Executes an approved decision in the environment: simulated fills in
   * backtest/sandbox, real exchange orders in live. Returns the resulting
   * position or null when the action did not fill.
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
   * Environment notification sink for runtime events. Unused in backtest.
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
  /** Overrides the counted actions when the stage produced reports itself. */
  reports?: number;
  /** Overrides the default "pass completed/failed" summary line. */
  summary?: string;
  /** Overrides the symbol count recorded for the pass. */
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
