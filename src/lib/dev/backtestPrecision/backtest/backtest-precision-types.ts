import type { Position } from "@/lib/system/trading";
import type { ExchangeType, VolatilityPoint } from "@/lib/system/types";

export interface BacktestPrecisionResult {
  exchangeType: ExchangeType;
  vPointsMap: Record<string, VolatilityPoint[]>;
  positions: Position[];
}
