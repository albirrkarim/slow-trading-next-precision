import type { BalanceSummary, Position } from "@/lib/system/trading";
import type { ExchangeType, VolatilityPoint } from "@/lib/system/types";

/** Aggregate balance across all enabled accounts captured at one timestamp. */
export interface BacktestBalanceSnapshot extends BalanceSummary {
  t: number;
}

export interface BacktestPrecisionResult {
  exchangeType: ExchangeType;
  vPointsMap: Record<string, VolatilityPoint[]>;
  positions: Position[];
  balanceSnapshots: BacktestBalanceSnapshot[];
}
