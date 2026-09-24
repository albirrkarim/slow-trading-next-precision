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

export type PositionReserveStepStatus =
  "RESERVED" | "UNRESERVED" | "USED" | "RELEASED";

export interface PositionReserveStep {
  level: number;
  marginUsdt: number;
  allocationPct: number;
  status: PositionReserveStepStatus;
  reservedMarginUsdt?: number;
  usedAt?: number;
  usedPrice?: number;
  releasedAt?: number;
}

export interface PositionAveragingExecution {
  t: number;
  level: number;
  marginUsdt: number;
  price: number;
  allocationPct: number;
  reservedMarginUsdt?: number;
  adaptiveMultiplier?: number;
  projectedProfitPct?: number;
  /** Frozen copy of the position's last monitoring stage when this fill completed. */
  monitoringState?: PositionLastMonitoringStage;
}

export interface PositionAveragingState {
  entryLevel: number;
  lastHandledLevel: number;
  reserveBaseMarginUsdt: number;
  reservedRemainingMarginUsdt: number;
  steps: PositionReserveStep[];
  executions?: PositionAveragingExecution[];
}

export interface PositionEntryDecision<TFeature = unknown> {
  /** Missing only when historical data cannot recover the engine. */
  engine?: string;
  feature?: TFeature;
  label?: string;
}

export interface PositionStrategyState<TFeature = unknown> {
  entry: PositionEntryDecision<TFeature>;
  averaging: PositionAveragingState;
}

export interface PositionPnlPoint {
  t: number;
  pct: number;
}

export interface PositionPnl {
  markPrice?: number;
  netPct?: number;
  netUsdt?: number;
  currentValueUsdt?: number;
  maxUpPct?: number;
  maxDownPct?: number;
  /** Best observed fee-aware net PnL in USDT. */
  maxUpUsdt?: number;
  /** Worst observed fee-aware net PnL in USDT. */
  maxDownUsdt?: number;
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

/** Canonical position persisted by production, sandbox, and backtest flows. */
// BOTH:CANONICAL_POSITION_STORAGE
export interface Position<TFeature = unknown> {
  /** Immutable account slug that owns this position. */
  account: string;
  symbol: string;
  executionMode: PositionExecutionMode;
  tradingMode: TradingMode;
  direction: PositionDirection;
  /** User-authored note attached to this persisted position or history row. */
  notes?: string;
  /** Latest successful production monitoring stage and its classification reason. */
  lastMonitoringStage?: PositionLastMonitoringStage;
  opened: PositionOpenEvent;
  /** Ordered intermediate vPoints; excludes opened.vPoint and closed.vPoint. */
  vPoints?: PositionVPointRef[];
  exposure: PositionExposure;
  fees: PositionFees;
  strategy: PositionStrategyState<TFeature>;
  pnl: PositionPnl;
  /** Latest valid funding snapshot for a monitored futures position. */
  funding?: PositionFundingSnapshot;
  control?: PositionControl;
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
