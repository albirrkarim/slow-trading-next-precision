import { VolatilityPoint } from "@/lib/dynamic";
import { Position } from "@/lib/trading/models";

export interface BacktestPrecisionResult {
  vPointsMap: Record<string, VolatilityPoint[]>;
  positions: Position[];
}
