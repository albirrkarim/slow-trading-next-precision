import type {
  ExchangeType,
  VolatilityPoint,
} from "../types/market";
import type { TradingMode } from "@/lib/exchange/types";

export type PositionExecutionMode = "live" | "sandbox";
export type OrderType = "taker" | "maker";
export type PositionDirection = "LONG" | "SHORT";
export type PositionEntrySourceOverride = "MANUAL" | "BYPASS";
export type PositionOpenReason = "COMMON" | "MANUAL" | "BYPASS" | "UNKNOWN";
export type PositionCloseSourceOverride = "MANUAL" | "EXCHANGE";

export interface PositionVPointRef {
  id: string;
  lvl: number;
}

export interface PositionOpenEvent {
  t: number;
  vPoint: PositionVPointRef;
  /** Omitted for automatic entries. */
  source?: PositionEntrySourceOverride;
  reason: PositionOpenReason;
  message: string;
  /** Immutable initial execution price before any averaging. */
  price: number;
}

export interface PositionExposure {
  quantity: number;
  averageEntryPrice: number;
  notionalUsdt: number;
  marginUsdt: number;
  leverage: number;
}

export interface PositionFees {
  entryUsdt: number;
  /** Open-position estimate only. Removed after close. */
  estimatedExitUsdt?: number;
}

/**
 * Lifecycle of one planned averaging step:
 * `RESERVED` — margin pre-committed at entry and excluded from spendable;
 * `UNRESERVED` — planned beyond the funded reserve, may still execute;
 * `USED` — consumed by a completed averaging fill;
 * `RELEASED` — freed without executing (e.g. position closed first).
 */
export type PositionReserveStepStatus =
  "RESERVED" | "UNRESERVED" | "USED" | "RELEASED";

/**
 * One planned averaging step in the reserve ladder, computed at entry from
 * `reserveBaseMarginUsdt` and the account's `watchReservePctAlloc`.
 */
export interface PositionReserveStep {
  /**
   * Absolute vPoint level this step waits for — each step sits one level
   * further into the adverse direction than the previous one.
   */
  level: number;
  /** Planned margin USDT for this step; overwritten with the actual spent amount on fill. */
  marginUsdt: number;
  /** Percent of the rolling margin total this step allocates. */
  allocationPct: number;
  status: PositionReserveStepStatus;
  /** Margin amount originally reserved, preserved when `marginUsdt` is overwritten on fill. */
  reservedMarginUsdt?: number;
  /** Fill time once the step is `USED`. */
  usedAt?: number;
  /** Executed price once the step is `USED`. */
  usedPrice?: number;
  /** Release time once the step is `RELEASED`. */
  releasedAt?: number;
}

/**
 * Record of one completed averaging fill, appended in execution order.
 */
export interface PositionAveragingExecution {
  /** Fill time in Unix milliseconds. */
  t: number;
  /** Ladder level this fill consumed. */
  level: number;
  /** Actual margin USDT added by this fill. */
  marginUsdt: number;
  /** Executed average price of this fill. */
  price: number;
  /** Percent of the rolling margin total this fill allocated. */
  allocationPct: number;
  /** Planned reserve amount this fill consumed, for reconciliation. */
  reservedMarginUsdt?: number;
  /** Adaptive-averaging multiplier applied, when adaptive averaging is enabled. */
  adaptiveMultiplier?: number;
  /** Rescue projection's expected profit pct at fill time, when adaptive averaging is enabled. */
  projectedProfitPct?: number;
  /** Frozen copy of the position's last monitoring stage when this fill completed. */
  monitoringState?: PositionLastMonitoringStage;
}

/**
 * Averaging ladder state for one open position: where it entered, which
 * adverse levels it has already consumed, how much reserve remains held,
 * the planned steps, and the completed fills.
 */
export interface PositionAveragingState {
  /**
   * Absolute vPoint level at entry; the anchor the ladder steps are
   * computed from (step `i` sits at `entryLevel ∓ (i+1)` depending on
   * direction).
   */
  entryLevel: number;
  /**
   * Most recent ladder level consumed by an averaging fill. Starts at
   * `entryLevel` and prevents the same level being consumed twice.
   */
  lastHandledLevel: number;
  /** Entry margin the ladder's percentage allocations were computed from. */
  reserveBaseMarginUsdt: number;
  /**
   * Sum of `marginUsdt` over steps still `RESERVED`. Mirrored into the
   * account balance's `reserved` total so it is excluded from spendable.
   */
  reservedRemainingMarginUsdt: number;
  /** Planned ladder steps in adverse-level order. */
  steps: PositionReserveStep[];
  /** Completed averaging fills, in execution order. */
  executions?: PositionAveragingExecution[];
}

/**
 * Record of the decision that opened the position. Written once at entry and
 * kept immutable so later audits can trace which engine and strategy data
 * authorized the trade.
 */
export interface PositionEntryDecision<TFeature = unknown> {
  /**
   * Identifier of the decision engine that produced the entry signal
   * (e.g. its version). Missing only when historical data cannot recover
   * the engine.
   */
  engine?: string;
  /**
   * Strategy-owned payload captured at entry. The shared runtime stores it
   * opaquely; only the owning strategy interprets its shape.
   */
  feature?: TFeature;
  /** Human-readable label describing why this entry was taken. */
  label?: string;
}

/**
 * Strategy-owned slice of a position: the immutable entry decision plus the
 * mutable averaging ladder the runtime maintains as averaging executes.
 *
 * @template TFeature - Strategy-defined entry feature payload.
 */
export interface PositionStrategyState<TFeature = unknown> {
  /** Why and how this position was opened; set once at entry. */
  entry: PositionEntryDecision<TFeature>;
  /**
   * Averaging ladder state: entry level, last handled adverse level,
   * remaining reserve, per-step reserve plan, and completed executions.
   * Updated by the shared runtime on every averaging fill.
   */
  averaging: PositionAveragingState;
}

export interface PositionPnlPoint {
  t: number;
  pct: number;
}

/**
 * Fee-aware PnL snapshot of a position, refreshed on every monitoring pass.
 *
 * `net*` values already include estimated round-trip fees, so they are the
 * canonical numbers exit rules, Speedup classification, and the dashboard
 * read. All fields are absent until the first successful monitoring update.
 */
export interface PositionPnl {
  /** Latest mark price observed for the position's symbol. */
  markPrice?: number;
  /**
   * Fee-aware net PnL as a percentage of entry margin. Negative means losing.
   * Drives Speedup/Standard classification and percentage-based exit rules.
   */
  netPct?: number;
  /**
   * Fee-aware net PnL in USDT. On close this becomes the realized amount
   * returned to the account balance on top of the released margin.
   */
  netUsdt?: number;
  /** Current position value in USDT: remaining margin plus net PnL. */
  currentValueUsdt?: number;
  /** Highest `netPct` ever observed while the position was open. */
  maxUpPct?: number;
  /** Lowest `netPct` ever observed while the position was open. */
  maxDownPct?: number;
  /** Best observed fee-aware net PnL in USDT. */
  maxUpUsdt?: number;
  /** Worst observed fee-aware net PnL in USDT. */
  maxDownUsdt?: number;
  /**
   * Bounded `{t, pct}` series sampled each monitoring pass, bucketed by
   * `runtime.pnlHistoryBucketMinutes` and capped to the most recent points.
   * Used by charts and diagnostics; not a decision input.
   */
  history?: PositionPnlPoint[];
}

/** Latest perpetual-futures funding snapshot observed while monitoring. */
export interface PositionFundingSnapshot {
  /** Exchange that supplied this snapshot. */
  exchange: ExchangeType;
  /** Raw decimal rate, where `0.0001` means `0.01%`. */
  rate: number;
  /** Exchange snapshot timestamp in Unix milliseconds. */
  t: number;
  /** Next scheduled funding settlement in Unix milliseconds. */
  nextT?: number;
}

export type PositionCloseReason =
  | "TAKE_PROFIT"
  | "STOP_LOSS"
  | "EXIT_ON_VPOINT_LEVEL"
  | "STOP_LOSS_BY_USDT_LOSS"
  | "LEVEL_BASED_PCT_DRIFT_STOP_LOSS"
  | "STOP_LOSS_PLUS_TP"
  | "VOLATILITY_TARGET_TP"
  | "VOLATILITY_TARGET_SL"
  | "POST_AVERAGE_RESCUE_EXIT"
  | "POST_AVERAGE_STOP_LOSS"
  /** @deprecated Retained so existing persisted history remains readable. */
  | "POST_AVERAGE_RESCUE_TP"
  | "FINAL"
  | "LIQUIDATED"
  | "MANUAL"
  | "FORCED"
  | "UNKNOWN";

export interface PositionCloseEvent {
  t: number;
  /** Omitted for automatic exits. */
  source?: PositionCloseSourceOverride;
  price: number;
  feeUsdt: number;
  vPoint?: PositionVPointRef;
  reason: PositionCloseReason;
  message: string;
}

export interface PositionControl {
  forceExit?: {
    reason: string;
  };
}

export type PositionMonitoringStage = "speedup" | "standard";

/** Last successful production monitoring pass recorded on the position. */
export interface PositionLastMonitoringStage {
  stage: PositionMonitoringStage;
  lastUpdated: number;
  reason: string;
}

/**
 * Canonical position persisted by production, sandbox, and backtest flows.
 *
 * One record represents one open or closed leg. A position is open while
 * `closed` is absent and becomes immutable history once `closed` is set.
 * The Precision Checker pairs records by account, symbol, direction, and the
 * entry `opened.vPoint.id`, so those identity fields must stay stable for the
 * position's whole lifecycle.
 *
 * @template TFeature - Strategy-owned feature payload carried through
 * `strategy.entry.feature`. Each strategy defines its own shape; the shared
 * runtime never reads inside it.
 */
// BOTH:CANONICAL_POSITION_STORAGE
export interface Position<TFeature = unknown> {
  /** Immutable account slug that owns this position. */
  account: string;
  /** Base asset symbol in canonical uppercase form, e.g. `"BTC"`. */
  symbol: string;
  /**
   * Environment that executed this position: `"live"` for real exchange
   * orders, `"sandbox"` for simulated production execution. Backtest runs
   * still stamp `"sandbox"`-style modes per their dataset contract.
   * Excluded from Precision Checker comparison.
   */
  executionMode: PositionExecutionMode;
  /** Market mode this position trades under (spot, margin, or futures). */
  tradingMode: TradingMode;
  /** Leg direction. `"LONG"` profits when price rises; `"SHORT"` when it falls. */
  direction: PositionDirection;
  /** User-authored note attached to this persisted position or history row. */
  notes?: string;
  /** Latest successful production monitoring stage and its classification reason. */
  lastMonitoringStage?: PositionLastMonitoringStage;
  /**
   * Immutable entry event: open time, the volatility point that authorized
   * the entry (`vPoint.id` is the Precision Checker pairing key), the
   * initial execution price before any averaging, and why the entry happened.
   */
  opened: PositionOpenEvent;
  /** Ordered intermediate vPoints; excludes opened.vPoint and closed.vPoint. */
  vPoints?: PositionVPointRef[];
  /**
   * Current market exposure: filled quantity, volume-weighted average entry
   * price, notional value, locked margin, and effective leverage. Averaging
   * executions mutate these fields in place.
   */
  exposure: PositionExposure;
  /**
   * Accumulated entry-side fees plus, while open, an estimated exit fee used
   * for fee-aware PnL. The estimate is removed after close.
   */
  fees: PositionFees;
  /**
   * Strategy-owned state: the entry decision that opened this position and
   * the averaging ladder (reserve steps and completed executions). The
   * runtime updates it; only the owning strategy interprets `entry.feature`.
   */
  strategy: PositionStrategyState<TFeature>;
  /**
   * Latest fee-aware PnL snapshot (mark price, net pct/USDT, observed
   * extremes) plus a bounded history bucket refreshed each monitoring pass.
   */
  pnl: PositionPnl;
  /** Latest valid funding snapshot for a monitored futures position. */
  funding?: PositionFundingSnapshot;
  /** Operator overrides applied to this position, e.g. a forced exit request. */
  control?: PositionControl;
  /**
   * Close event written once the exit fills: time, price, exit fee, the
   * vPoint that triggered the exit when applicable, and the close reason.
   * Its presence marks the position closed; open-position lookups must
   * filter it out.
   */
  closed?: PositionCloseEvent;
}

/**
 * A union type representing the possible trade decisions.
 */
export interface TradeDecision {
  action: "BUY" | "SELL" | "HOLD";

  /**
   * Current Price USDT in klines
   */
  price?: number;

  /**
   * Amount to buy or sell that the model trading suggest
   *
   * BUY decisions tell you how much USDT to spend.
   * SELL decisions tell you how much of the coin to sell (your current holdings).
   */
  amount?: number;

  /**
   * Position mana yang di jual ini untuk jual partial
   */
  position?: Position;

  /**
   * Net Profit or loss in percentage (%)
   *
   * 0-1
   */
  profit?: number;

  /**
   * Decision reason
   */
  reason?: string;

  /**
   *
   */
  category?: string;

  /**
   * Server Logging
   */
  log?: string;

  /**
   * Simple notif to email
   */
  emailNotif?: string;

  /** Volatility point that authorized a new entry. */
  entryVPoint?: PositionVPointRef;
}

export interface TradeRecommendationBase extends VolatilityPoint {
  /**
   * eg.
   * - good for FUTURES (LONG) and SPOT
   * - good for FUTURES (SHORT)
   */
  message: string;
}

/**
 * This is a recommendation to open a new position.
 */
export interface EntryRecommendation extends TradeRecommendationBase {
  /**
   * Confidence/allocation weight from the decision engine, from 0 to 1.
   *
   * Backtest:
   * - Decision engines convert this into investAmount before opening entries.
   * - Backtest entry then uses investAmount as the desired margin USDT.
   * - Futures backtest entry maps amountProbab into the same initial leverage
   *   range as production before applying the leverage caps.
   *
   * Production:
   * - Live entry sizes the order as runtimeBudgetUSDT * amountProbab.
   * - Futures entry also maps amountProbab into the initial leverage range
   *   before applying entrySignal.maxLeverage and dynamicTradeConfig.maxLeverage
   *   as caps. A positive dynamicTradeConfig.exactLeverage overrides that
   *   calculation.
   */
  amountProbab: number;

  /**
   * Max leverage suggested by the decision engine.
   * Futures entry uses this as an engine cap in both backtest and production.
   */
  maxLeverage: number;

  /**
   * Resolved margin USDT for this entry recommendation.
   * Backtest entry uses this directly; live entry currently receives
   * the budget separately and still sizes by amountProbab.
   */
  investAmount?: number;
}

/**
 * This is a recommendation to add margin to an existing open position.
 */
export interface AveragingRecommendation extends TradeRecommendationBase {
  /**
   * Margin USDT to spend on this averaging step.
   */
  investAmount: number;

  /**
   * Position leverage retained for fallback/reporting.
   */
  maxLeverage?: number;
}

export interface PostAverageRescueExitThreshold {
  /** Minimum completed averaging executions required to use this threshold. */
  minAveragingCount: number;
  /** Minimum fee-aware net PnL percentage required for exit. */
  minNetPnlPct: number;
}

/** Configures the tiered post-average rescue exit shared by all trading flows. */
export interface PostAverageRescueExitConfig {
  /** Enables the post-average rescue exit rule. */
  enabled: boolean;
  /** Threshold selected by the greatest qualifying minimum averaging count. */
  thresholds: PostAverageRescueExitThreshold[];
}

/** One completed-averaging tier for the post-average stop loss. */
export interface PostAverageStopLossThreshold {
  /** Minimum completed averaging executions required to use this tier. */
  minAveragingCount: number;
  /** Negative fee-aware net PnL percentage boundary; zero disables it. */
  maxNetPnlPct: number;
  /** Negative fee-aware net USDT boundary; zero disables it. */
  maxNetPnlUsdt: number;
  /**
   * Positive adverse price-drift percentage measured from the vPoint latest
   * when the most recent averaging execution completed; zero disables it.
   */
  adverseDriftPct?: number;
}

/** Configures tiered post-average loss boundaries enabled after averaging. */
export interface PostAverageStopLossConfig {
  enabled: boolean;
  thresholds: PostAverageStopLossThreshold[];
}

/** One exact absolute vPoint level and its adverse price-drift boundary. */
export interface LevelBasedPctDriftStopLossCondition {
  /** Exact absolute vPoint level that activates this condition. */
  absoluteLevel: number;
  /** Adverse price drift from that vPoint price, expressed as a percentage. */
  adverseDriftPct: number;
}

/** Configures stop loss boundaries anchored to exact absolute vPoint levels. */
export interface LevelBasedPctDriftStopLossConfig {
  enabled: boolean;
  conditions: LevelBasedPctDriftStopLossCondition[];
}

/** Adaptive averaging multiplier search bounds for rescue projections. */
export interface AdaptiveAveragingConfig {
  enabled: boolean;
  maxMultiplier: number;
  minProjectedProfitPct: number;
}

/** Account balance summary shared by the runtime and dashboard surfaces. */
export interface BalanceSummary {
  // BOTH:BALANCE_AVAILABLE — exchange free quote = spendable + reserved +
  // safeHaven.
  available: number;
  // BOTH:BALANCE_RESERVED — virtual reserve held for averaging open positions.
  reserved: number;
  // BOTH:BALANCE_SPENDABLE — virtual; available - reserved - safeHaven.
  spendable: number;
  // BOTH:BALANCE_SAFE_HAVEN — virtual; protected amount excluded from spendable.
  safeHaven: number;
  startingBalance: number;
  // BOTH:BALANCE_LOCKED — total margin held by active open positions.
  locked: number;
  total: number;
}

/** Closed or open position decorated with the mode that owns the history row. */
export interface RuntimeHistoryPosition extends Position {
  /** Mode that owns this history row. */
  mode: PositionExecutionMode;
}
