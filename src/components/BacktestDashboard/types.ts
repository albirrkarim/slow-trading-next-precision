import type { PrecisionRunMetricsV1 } from "@/lib/precision";

/** Live status of one spawned backtest driver run. */
export interface BacktestRunStatus {
  status: "starting" | "running" | "done" | "error";
  updatedAt: number;
  currentTime?: number;
  processedMinutes?: number;
  totalMinutes?: number;
  fileName?: string;
  positionCount?: number;
  metrics?: PrecisionRunMetricsV1;
  error?: string;
}
