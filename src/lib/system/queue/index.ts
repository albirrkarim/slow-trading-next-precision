import { DEFAULT_EXCHANGE_ACCOUNT_SLUG } from "@/lib/exchange/account-context";
import { runtimeStorage } from "../storage";
import queueProcess from "./process";
import queueStore from "./store";
import type {
  RuntimeManualQueueCreateInput,
  RuntimeQueueItem,
  RuntimeQueueKind,
  RuntimeSafeHavenQueueItem,
  RuntimeWithdrawalQueueItem,
} from "./types";

/** Deletes one queue item by kind and stable id. */
async function cancel(
  kind: RuntimeQueueKind,
  id: string,
): Promise<boolean> {
  return queueStore.mutateQueues((queues) => {
    const collection =
      kind === "safe_haven" ? queues.safeHaven : queues.withdrawals;
    const index = collection.findIndex((item) => item.id === id);

    if (index < 0) {
      return false;
    }

    collection.splice(index, 1);
    return true;
  });
}

/**
 * Creates one queue item from the dashboard and advances its normal scheduler
 * marker so deleting the item cannot immediately recreate it.
 */
async function createManual(
  input: RuntimeManualQueueCreateInput,
  currentTimeMs = Date.now(),
): Promise<RuntimeQueueItem> {
  const catalog = await runtimeStorage.catalog.ensure();
  const accountSlug =
    catalog.config.accounts[0]?.slug ?? DEFAULT_EXCHANGE_ACCOUNT_SLUG;
  const activeMode = catalog.mode;

  if (input.kind === "safe_haven") {
    const amountUSDT = Number(
      Math.max(0, Number(input.amountUSDT) || 0).toFixed(8),
    );
    if (!(amountUSDT > 0)) {
      throw new Error("Safe Haven queue amount must be greater than 0 USDT.");
    }

    const period = queueStore.getUtcMonthKey(currentTimeMs);
    const item = await queueStore.mutateQueues((queues) => {
      if (
        queues.safeHaven.some(
          (candidate) =>
            candidate.account === accountSlug &&
            candidate.mode === activeMode &&
            !candidate.scheduleId,
        )
      ) {
        throw new Error(
          `A ${activeMode} Safe Haven queue item is already pending.`,
        );
      }

      const created: RuntimeSafeHavenQueueItem = {
        account: accountSlug,
        id: `safe-haven-manual-${activeMode}-${currentTimeMs}`,
        kind: "safe_haven",
        mode: activeMode,
        period,
        requestedUSDT: amountUSDT,
        remainingUSDT: amountUSDT,
        createdAt: currentTimeMs,
        nextAttemptAt: currentTimeMs,
        lastMessage: `Manually queued ${amountUSDT} USDT for ${activeMode} Safe Haven.`,
      };
      queues.safeHaven.push(created);
      return created;
    });

    const queues = await queueStore.loadQueues();
    const modeState = await runtimeStorage.account.load({
      accountSlug,
      mode: activeMode,
    });
    modeState.balance.lastSafeHavenRequest = currentTimeMs;
    modeState.balance.safeHavenRequest = queues.safeHaven.reduce(
      (total, candidate) =>
        total +
        (candidate.account === accountSlug && candidate.mode === activeMode
          ? candidate.remainingUSDT
          : 0),
      0,
    );
    await runtimeStorage.account.save({
      accountSlug,
      mode: activeMode,
      state: modeState,
    });
    return item;
  }

  const scheduleId = String(input.scheduleId ?? "").trim();
  const withdrawalConfig = catalog.config.runtime.withdrawal;
  const schedule = withdrawalConfig?.schedules.find(
    (candidate) => candidate.id === scheduleId,
  );
  if (!schedule) {
    throw new Error("Choose an existing withdrawal schedule.");
  }

  const amountUSDT = Math.max(0, Number(schedule.amountUSDT) || 0);
  if (!(amountUSDT > 0)) {
    throw new Error("Withdrawal schedule amount must be greater than 0 USDT.");
  }

  const { targetNetwork, targetWalletAddress } =
    queueStore.resolveWithdrawalTarget(withdrawalConfig, schedule);
  const item = await queueStore.mutateQueues((queues) => {
    if (
      queues.withdrawals.some(
        (candidate) => candidate.scheduleId === schedule.id,
      )
    ) {
      throw new Error(
        `A withdrawal queue item for schedule "${schedule.name}" is already pending.`,
      );
    }

    const created: RuntimeWithdrawalQueueItem = {
      account: schedule.account,
      id: `withdrawal-manual-${schedule.id}-${currentTimeMs}`,
      kind: "withdrawal",
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      amountUSDT,
      targetNetwork,
      targetWalletAddress,
      clientWithdrawId: `slow-${schedule.id}-${currentTimeMs}`.slice(0, 64),
      createdAt: currentTimeMs,
      nextAttemptAt: currentTimeMs,
      lastMessage: `Manually queued automatic withdrawal schedule "${schedule.name}" for ${amountUSDT} USDT.`,
    };
    queues.withdrawals.push(created);
    return created;
  });

  await runtimeStorage.catalog.update({
    account: schedule.account,
    withdrawal: {
      schedules: (withdrawalConfig?.schedules ?? []).map((candidate) =>
        candidate.id === schedule.id
          ? { ...candidate, lastQueuedAt: currentTimeMs }
          : candidate,
      ),
    },
  });

  return item;
}

const runtimeQueue = {
  items: {
    cancel,
    createManual,
    load: queueStore.loadQueues,
  },
  process: queueProcess,
} as const;

export default runtimeQueue;
export { runtimeQueue };
export type * from "./types";
