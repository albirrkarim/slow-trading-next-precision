import type { VolatilityPoint } from "@/lib/dynamic";
import type { ExchangeType } from "@/lib/exchange";
import type { Position } from "@/lib/trading/models";

export interface BacktestPrecisionResult {
  exchangeType: ExchangeType;
  vPointsMap: Record<string, VolatilityPoint[]>;
  positions: Position[];
}
