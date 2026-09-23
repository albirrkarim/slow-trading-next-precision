
import type { RuntimeDashboardState } from "@/lib/system/dashboard";
import { runtimeWorkerCapacity } from "@/lib/system/trading";

export type { RuntimeWorkerCapacity } from "@/lib/system/trading";

/** Calculates equal-sized additional entry workers using live entry constraints. */
export function calculateSlowWorkerCapacity(
  dashboardState: RuntimeDashboardState,
): ReturnType<typeof runtimeWorkerCapacity.calculate> {
  const spendableUsdt = Math.max(
    0,
    dashboardState.balances.spendableQuoteAsset,
  );

  return runtimeWorkerCapacity.calculate({
    activePositions: dashboardState.openPositions,
    config: dashboardState.config,
    spendableUsdt,
  });
}
