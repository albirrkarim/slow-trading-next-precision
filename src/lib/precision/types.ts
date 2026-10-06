import type { StrategyAPI } from "@/lib/strategies";
import type { RuntimeFeatures } from "@/lib/features/types";
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
import type { BlackSwanState } from "@/lib/system/trading/black-swan";

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

/**
 * Core runtime state every environment supplies to the engine — time,
 * positions, config, balances, and market data.
 */
export interface RuntimeEngineStateBasic {
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

  /**
   * Free-form slot owned by the plugged decision strategy (e.g. streak's
   * pending re-entry records). The engine carries and persists it inside
   * the runtime state/snapshot but never interprets it — the strategy
   * assigns and reads its own shape (`context.state.strategy`).
   */
  strategy?: unknown;

  /**
   * Derived feature store refreshed by `adapter.onFeatureUpdate` before
   * every capture-entry pass (and once during startup warm-up). Written by
   * the shared `lib/features` module so live, sandbox, and backtest compute
   * identical values; strategies may gate candidates on it and the entry
   * commit snapshots the coin's features into `position.strategy.entry`.
   */
  features?: RuntimeFeatures;
}

/**
 * Inputs the shared `precision/guard` gate reads — each environment seeds or
 * refreshes them instead of re-implementing policy. All optional: absent
 * means "no bound" for backtests and "evaluate as unset" for production.
 */
export interface RuntimeEngineStateGuard {
  /**
   * Accumulated net USDT PnL of trades closed on `dailyPnlDay`, maintained
   * by the shared exit path (`guard.dailyPnl.recordClose`). The shared
   * guard evaluates it against `runtime.autoEntryDailyPnlLimitUSDT`
   * without scanning trade history. Production additionally refreshes it
   * from the combined live+sandbox persisted read each management cycle.
   */
  dailyPnlUsdt?: number;

  /**
   * UTC day key (`YYYY-MM-DD`) `dailyPnlUsdt` belongs to. A mismatched day
   * resolves the accumulator to zero — the daily stop resets at UTC
   * midnight.
   */
  dailyPnlDay?: string;

  /**
   * Black Swan protective flag read by the shared guard to veto entries
   * and averaging — kept as the derived compatibility view; when
   * `blackSwanStatus` is present the guard prefers the full state.
   * Production's risk-sentinel stage persists and refreshes both each
   * cycle; normal backtests refresh them silently from historical candles
   * on every sentinel tick; the precision checker retains the captured
   * starting flag/status.
   */
  blackSwanProtective?: boolean;

  /**
   * Latest full Black Swan detector output (status, reason, evidence,
   * cooldown bookkeeping). Canonical when present — the guard and entry
   * diagnostics read it directly and `blackSwanProtective` stays a derived
   * view for older snapshots and writers that only track the flag.
   */
  blackSwanStatus?: BlackSwanState;

  /**
   * BTEST:STOP_AUTO_ENTRY_BEFORE_END — optional Unix-ms bound the shared
   * guard applies to automatic entries. Backtest adapters seed it from the
   * run window; production leaves it unset.
   */
  entryCutoffTime?: number;
}

export interface RuntimeEngineState
  extends RuntimeEngineStateBasic,
    RuntimeEngineStateGuard {}

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
   * Written by the execution adapter when an entry-planning gate refused
   * this candidate (funding, drift, sizing) — a strategy skip, not an
   * execution failure, so it carries no notification and no error log.
   * Carried uninterpreted into `onActionResult` so strategy bookkeeping
   * can persist the real reason (e.g. `state.strategy` records). Unset
   * when the candidate filled or a thrown execution error aborted it.
   */
  blockReason?: string;
  /**
   * Strategy-authored entry-feature payload landing on
   * `position.strategy.entry.feature` at commit. When unset the shared
   * commit stores the live `state.features` store pruned to the BTC market
   * anchor plus the leg's own symbol, so every position records the
   * feature context seen at entry regardless of strategy.
   */
  feature?: unknown;
  /**
   * Free-form strategy-owned payload carried through guard, adapter, and
   * `onActionResult` uninterpreted. On a successful entry the shared commit
   * copies it onto `position.strategy.logic`, so pair identity (pairId,
   * role, entryLegs) survives the decision→position hop without the engine
   * knowing its shape.
   */
  strategy?: unknown;
  /**
   * Strategy-owned usage markers written onto the source vPoint after the
   * entry fills. Defaults to `[accountSlug]`; pair strategies emit
   * `"<slug>:<ROLE>"` markers instead.
   */
  vPointUsage?: string[];
}

/**
 * Atomic both-direction entry candidate: an ordered set of leg decisions
 * that must all fill or all unwind. Produced by pair strategies (e.g.
 * `both` emits MAIN+COUNTER legs per signal) and executed through
 * `adapter.onPairAction`, which owns sequential leg submission and
 * compensating-close rollback when a later leg fails.
 *
 * Top-level `accountSlug`/`symbol`/`message` describe the pair as a unit so
 * the shared guard's entry policy (catalog, min price, stale vPoint,
 * cutoff, daily PnL) applies unchanged — all pair legs share them by
 * contract.
 */
export interface RuntimePairEntryDecision {
  /** Discriminant identifying this decision as an atomic pair entry. */
  type: "pairEntry";
  /** Account that owns the balance and the resulting positions. */
  accountSlug: string;
  /** Human-readable reason shown in notifications and logs. */
  message: string;
  /** Operator-forced entry: bypasses the auto-entry runtime gate. */
  manual?: boolean;
  /** Base symbol both legs trade, e.g. `SUI`. */
  symbol: string;
  /**
   * Adapter-written gate-skip reason for the pair as a unit — mirrors the
   * `blockReason` stamped on the refused leg so `onActionResult` can read
   * it without scanning `legs`.
   */
  blockReason?: string;
  /**
   * Ordered leg decisions — every leg is a complete entry decision
   * (direction, entrySignal, per-leg `vPointUsage`, per-leg `strategy`
   * meta). Execution and compensation run in array order.
   */
  legs: RuntimeEntryDecision[];
  /**
   * Strategy-owned pair payload carried into guard and `onActionResult`
   * uninterpreted (per-leg meta lives on `legs[].strategy` and lands on
   * each `position.strategy.logic` at commit time).
   */
  strategy?: unknown;
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
   * Written by the execution adapter when the averaging plan was refused
   * (rescue-projection guard, minimum order size, insufficient balance) —
   * carried uninterpreted into `onActionResult` and the failure
   * notification so the refusal stays explainable.
   */
  blockReason?: string;
  /**
   * Free-form strategy-owned payload carried through guard, adapter, and
   * `onActionResult` uninterpreted; correlations only — the averaged
   * position already exists.
   */
  strategy?: unknown;
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
  /**
   * Written by the execution adapter when an exit was refused before the
   * order stage — carried uninterpreted into `onActionResult` and the
   * failure notification.
   */
  blockReason?: string;
  /** Base symbol of the open position. */
  symbol: string;
  /** Free-form strategy-owned payload carried into guard and
   * `onActionResult` uninterpreted (e.g. coordinated pair-close markers). */
  strategy?: unknown;
  /** Exit evaluation output (reason, target price, full/partial close). */
  tradeDecision: TradeDecision;
}

/** Entry-like candidates the entry-capture stage can dispatch. */
export type RuntimeEntryCandidate =
  | RuntimeEntryDecision
  | RuntimePairEntryDecision;

/** Any action a stage can ask the strategy gate and adapter to execute. */
export type RuntimeDecision =
  | RuntimeEntryDecision
  | RuntimePairEntryDecision
  | RuntimeAveragingDecision
  | RuntimeExitDecision;

/** Opaque strategy-owned volatility detector memory. */
export interface RuntimeVPointMemory {
  readonly value: unknown;
}

export type OnActionEnvGuard = (
  decision: RuntimeDecision,
  context: RuntimeContext,
) => Promise<boolean>;

export type OnExit = (
  position: Position,
  context: RuntimeContext,
) => Promise<void>;

/**
 * Observation hook fired once `adapter.onAction`/`onPairAction` ran:
 * `"success"` carries the produced position (or the leg array for a
 * `pairEntry` decision — the pair is the bookkeeping unit), `"failed"` a
 * null — so strategy bookkeeping can distinguish a real fill from a
 * rejected execution. Vetoed candidates never reach `onAction`, so they
 * produce no result.
 */
export type OnActionResult = (
  result: "success" | "failed",
  decision: RuntimeDecision,
  position: Position | Position[] | null,
  context: RuntimeContext,
) => Promise<void> | void;

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
   * Feature-store refresh dispatched once at startup warm-up and inside
   * every capture-entry prep block — after `updateMarkPrice`/
   * `updateVPointsMap` and before the entry capture. Every implementation
   * delegates to the shared `lib/features` module; the backtest adapter
   * additionally delta-records changed coin features into its artifact
   * stream, production just keeps `state.features` current.
   */
  onFeatureUpdate?: (
    context: RuntimeContext,
  ) => Promise<void> | void;

  /**
   * Optional environment-specific approval extension that runs after the
   * shared guard (`precision/guard`) and before `onAction`. The
   * shared guard already covers the state-readable policy identical across
   * environments (runtime toggles, account enablement, configured symbols,
   * minimum price, daily-PnL stop, entry cutoff, black-swan flag); this
   * hook is only for checks that need live IO — e.g. production re-reading
   * the persisted catalog/status at the execution boundary. Backtests
   * leave it unset so replayed windows follow the shared guard exactly.
   */
  onActionEnvGuard?: OnActionEnvGuard;

  /**
   * Executes an approved decision in the environment: simulated fills in
   * backtest/sandbox, real exchange orders in live. Returns the resulting
   * position or null when the action did not fill.
   */
  onAction: (
    decision: RuntimeDecision,
    context: RuntimeContext,
  ) => Promise<Position | null>;

  /**
   * Executes an approved pair entry atomically: the environment submits the
   * legs sequentially and must unwind already-filled legs (compensating
   * close live, discard in simulation) when a later leg fails — the engine
   * commits the pair to shared state only on full success.
   *
   * Returns every produced position in leg order, or null when the pair did
   * not complete. Environments without pair support may leave it unset; the
   * engine then rejects `pairEntry` decisions with a logged warning instead
   * of falling back to per-leg `onAction` calls.
   */
  onPairAction?: (
    decision: RuntimePairEntryDecision,
    context: RuntimeContext,
  ) => Promise<Position[] | null>;

  /** Persists a closed position after the shared runtime updates its state. */
  onExit: OnExit

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
   * notifications, and emergency-exit marking; normal backtests evaluate
   * the same detector over dataset candles and mark emergency exits
   * silently; the precision checker omits it.
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
  /**
   * Resolved strategy module plugged into this engine — undefined means the
   * built-in default pipeline. Distinct from `state.strategy`, which is the
   * strategy-owned free-form data slot this module reads and writes.
   */
  strategy?: StrategyAPI;
}
