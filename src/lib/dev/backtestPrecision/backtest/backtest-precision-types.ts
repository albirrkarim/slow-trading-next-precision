import type { BalanceSummary, Position } from "@/lib/system/trading";
import type { ExchangeType, VolatilityPoint } from "@/lib/system/types";

/** One account's balance summary captured at a single timestamp. */
export interface BacktestBalanceSnapshot extends BalanceSummary {
  t: number;
}

export interface BacktestPrecisionResult {
  exchangeType: ExchangeType;
  vPointsMap: Record<string, VolatilityPoint[]>;
  positions: Position[];
  /** Per-account balance timelines keyed by account slug. */
  balanceSnapshots: Record<string, BacktestBalanceSnapshot[]>;
}
