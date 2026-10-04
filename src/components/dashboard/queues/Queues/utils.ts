import type { RuntimeDashboardState } from "@/lib/system/dashboard";
import type { RuntimeSafeHavenQueueItem, RuntimeWithdrawalQueueItem } from "@/lib/system/queue";

export const QUEUE_POLL_INTERVAL_MS = 30_000;
export const QUEUE_ATTEMPT_INTERVAL_MS = 5 * 60 * 1000;

export type QueueRow =
  | RuntimeSafeHavenQueueItem
  | RuntimeWithdrawalQueueItem;

export function formatTime(timestamp: number) {
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toLocaleString()
    : "-";
}

export function formatDetailedTime(timestamp: number) {
  const date = new Date(timestamp);
  const localTimezone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "local time";
  const utc = date.toISOString().replace("T", " ").replace("Z", " UTC");

  return `${date.toLocaleString()} ${localTimezone} (${utc})`;
}

export function formatUSDT(value: number) {
  return `$${value.toFixed(2)}`;
}

export function maskWalletAddress(address: string) {
  const normalized = address.trim();
  if (normalized.length <= 12) {
    return normalized || "missing address";
  }

  return `${normalized.slice(0, 6)}…${normalized.slice(-6)}`;
}

export function getQueueAction(row: QueueRow): string {
  if (row.kind === "safe_haven") {
    return `Move ${formatUSDT(row.remainingUSDT)} of ${formatUSDT(row.requestedUSDT)} from spendable balance into Safe Haven for ${row.period}.`;
  }

  return `Withdraw ${formatUSDT(row.amountUSDT)} from schedule "${row.scheduleName}" through ${row.targetNetwork || "an unconfigured network"} to ${maskWalletAddress(row.targetWalletAddress)}.`;
}

/** Estimates the Safe Haven amount that the monthly scheduler would request. */
export function getSuggestedSafeHavenAmountUSDT(
  dashboardState: RuntimeDashboardState | null,
): number {
  if (!dashboardState) {
    return 0;
  }

  const tradingConfig = dashboardState.config;
  const schedule = dashboardState.runtime.safeHaven.schedules.find(
    (candidate) => candidate.enabled,
  );
  const currentAsset =
    dashboardState.balances.availableQuoteAsset +
    dashboardState.balances.lockedQuoteAsset;
  const fixedUSDT = Math.max(
    0,
    Number(schedule?.amountUSDT ?? tradingConfig.safeUSDTPerMonth) || 0,
  );
  const percent = Math.max(
    0,
    schedule
      ? (Number(schedule.pct) || 0) / 100
      : Number(tradingConfig.safePercentPerMonth) || 0,
  );
  const desiredUSDT =
    fixedUSDT > 0 ? fixedUSDT : currentAsset * percent;
  const minimumTradingCapitalUSDT = Math.max(
    0,
    Number(tradingConfig.minimalAssetOnTrade) || 0,
  );

  return Number(
    Math.min(
      desiredUSDT,
      Math.max(0, currentAsset - minimumTradingCapitalUSDT),
    ).toFixed(8),
  );
}
