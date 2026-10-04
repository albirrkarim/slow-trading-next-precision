
import type { RuntimeDashboardState } from "@/lib/system/dashboard";
import { runtimeWorkerCapacity } from "@/lib/system/trading";
import pair from "@/lib/strategies/shared/pair";

export type { RuntimeWorkerCapacity } from "@/lib/system/trading";

/** Calculates equal-sized additional entry workers using live entry constraints. */
export function calculateWorkerCapacity(
  dashboardState: RuntimeDashboardState,
): ReturnType<typeof runtimeWorkerCapacity.calculate> {
  const spendableUsdt = Math.max(
    0,
    dashboardState.balances.spendableQuoteAsset,
  );

  return runtimeWorkerCapacity.calculate({
    activePositions: dashboardState.openPositions,
    config: dashboardState.config,
    legsPerWorker: pair.legsPerWorker(dashboardState.config),
    // Pair mode: one open pair occupies one worker slot.
    openWorkers: pair.collapse(dashboardState.openPositions).length,
    spendableUsdt,
  });
}
