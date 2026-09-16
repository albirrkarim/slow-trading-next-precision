import slowTradingClient, {
  type SlowTradingDashboardState,
} from "@/lib/runtime/client";

export type { SlowWorkerCapacity } from "@/lib/runtime/worker-capacity";

/** Calculates equal-sized additional entry workers using live entry constraints. */
export function calculateSlowWorkerCapacity(
  dashboardState: SlowTradingDashboardState,
): ReturnType<typeof slowTradingClient.workerCapacity.calculate> {
  const spendableUsdt = Math.max(
    0,
    dashboardState.balances.spendableQuoteAsset,
  );

  return slowTradingClient.workerCapacity.calculate({
    activePositions: dashboardState.openPositions,
    config: dashboardState.config,
    spendableUsdt,
  });
}
