import type { VolatilityPoint } from "@/lib/dynamic";
import type { Position } from "@/lib/trading/models";

export interface BacktestPrecisionResult {
  vPointsMap: Record<string, VolatilityPoint[]>;
  positions: Position[];
}
