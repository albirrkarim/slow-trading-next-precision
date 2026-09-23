import type { VolatilityPoint } from "@/lib/system/types";
import type { RuntimeEffectiveConfig } from "@/lib/system/runtime/types";
import type { RuntimeHistoryPosition } from "@/lib/system/trading/types";

/** One account strategy + independent starting balance for a combined run. */
export interface RuntimeQuickBacktestAccountInput {
  slug: string;
  name?: string;
  enabled: boolean;
  /** Flat effective trading config (management + trading fields merged). */
  config: Partial<RuntimeEffectiveConfig>;
  startAmount: number;
}

export interface RuntimeQuickBacktestInput {
  /** Flat effective config shared by every account when `accounts` is absent. */
  config: Partial<RuntimeEffectiveConfig>;
  /** Enabled account strategies and their independent starting balances. */
  accounts?: RuntimeQuickBacktestAccountInput[];
  startAmount?: number;
  startTime?: number;
  endTime?: number;
  range?: string;
  signal?: AbortSignal;
  /**
   * Stored dashboard volatility points. Points before `startTime` seed the
   * runtime's detector memory so in-range detection continues the live chain;
   * in-range points are re-detected by the shared engine from real klines.
   */
  volatilityMap?: Record<string, VolatilityPoint[]>;
  /** Optional 24h quote volume per symbol for the entry volume cap. */
  volume24hBySymbol?: Record<string, number>;
  verbose?: boolean;
}

/** One equity snapshot of the simulated balance over the backtest window. */
export interface RuntimeQuickBacktestGrowthPoint {
  timeMs: number;
  /** Free quote balance. */
  currentBalance: number;
  /** Quote balance available for new entries. */
  currentSpendableBalance: number;
  /** Quote balance locked in averaging reserves. */
  currentReservedBalance: number;
  /** Total quote equity (available + locked). */
  currentAsset: number;
  /** Total quote equity plus unrealized PnL of open positions. */
  currentAssetFloating: number;
  /** Notional USDT currently held in open positions. */
  currentBaseAsset: number;
  /** Quote balance moved to safe haven. */
  currentSafeHaven: number;
}

export interface RuntimeQuickBacktestMetrics {
  entryCount: number;
  sharpeRatio: number;
  gainPct: number;
  gainUsdt: number;
  finalUsdt: number;
  avgProfitUsdtPerWeek: number;
  maxPositionDrawdownPct: number;
  minHoldDurationMs: number;
  totalHoldDurationMs: number;
  avgHoldDurationMs: number;
  maxHoldDurationMs: number;
  minHoldDuration: string;
  totalHoldDuration: string;
  avgHoldDuration: string;
  maxHoldDuration: string;
  minActiveCapitalDurationMs: number;
  totalActiveCapitalDurationMs: number;
  avgActiveCapitalDurationMs: number;
  maxActiveCapitalDurationMs: number;
  minActiveCapitalDuration: string;
  totalActiveCapitalDuration: string;
  avgActiveCapitalDuration: string;
  maxActiveCapitalDuration: string;
  minUnusedCapitalDurationMs: number;
  totalUnusedCapitalDurationMs: number;
  avgUnusedCapitalDurationMs: number;
  maxUnusedCapitalDurationMs: number;
  minUnusedCapitalDuration: string;
  totalUnusedCapitalDuration: string;
  avgUnusedCapitalDuration: string;
  maxUnusedCapitalDuration: string;
}

/** One chart marker in the dashboard simulation/growth series. */
export interface RuntimeQuickBacktestMarker {
  time: number;
  level: number;
  color?: string;
  text?: string;
}

export interface RuntimeQuickBacktestResult {
  metrics: RuntimeQuickBacktestMetrics;
  tradeHistory: RuntimeHistoryPosition[];
  growthOvertimeSeries: {
    names: string[];
    series: RuntimeQuickBacktestMarker[][];
  };
  simulationSeries: {
    names: string[];
    series: RuntimeQuickBacktestMarker[][];
  };
}
