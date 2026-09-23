import { DEFAULT_EXCHANGE_ACCOUNT_SLUG } from "@/lib/exchange/account-context";
import type { RuntimeMode } from "../runtime/types";
import runtimeSafeHavenSchedule from "../safehaven/schedule";
import { runtimeLogs, runtimeStorage } from "../storage";
import runtimeAccountState from "../storage/account-state";
import type { RuntimeStorageCatalog } from "../storage/catalog";
import runtimeWithdrawal from "../withdrawal";
import runtimeWithdrawalSchedule from "../withdrawal/schedule";
import queueStore from "./store";
import type {
  RuntimeQueues,
  RuntimeSafeHavenQueueItem,
  RuntimeWithdrawalQueueItem,
} from "./types";

/** One queue retry waits for the next management pass. */
const QUEUE_ATTEMPT_INTERVAL_MS = 5 * 60_000;
/** USDT amounts below this are treated as zero. */
const EPSILON_USDT = 1e-8;

/** Summary of one queue-processing pass for the stage report. */
export interface RuntimeQueueProcessSummary {
  /** Items auto-created from due schedules this pass. */
  queued: number;
  /** Pending items finished and deleted this pass. */
  completed: number;
  /** USDT moved into Safe Haven this pass. */
  movedUSDT: number;
}

function finiteBalance(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/** Resolves a schedule's requested amount: fixed USDT wins over pct of assets. */
function resolveScheduleAmountUSDT(
  schedule: { amountUSDT: number; pct: number },
  portfolioUSDT: number,
): number {
  const fixed = Math.max(0, Number(schedule.amountUSDT) || 0);
  if (fixed > 0) {
    return fixed;
  }
  const pct = Math.min(100, Math.max(0, Number(schedule.pct) || 0));
  return Number(((portfolioUSDT * pct) / 100).toFixed(8));
}

/** Patches one pending queue item's attempt metadata. */
async function patchItemAttempt(
  kind: "safe_haven" | "withdrawal",
  id: string,
  patch: {
    lastAttemptAt: number;
    nextAttemptAt: number;
    lastMessage: string;
    remainingUSDT?: number;
  },
): Promise<boolean> {
  return queueStore.mutateQueues((queues) => {
    const collection =
      kind === "safe_haven" ? queues.safeHaven : queues.withdrawals;
    const target = collection.find((item) => item.id === id);
    if (!target) {
      return false;
    }
    target.lastAttemptAt = patch.lastAttemptAt;
    target.nextAttemptAt = patch.nextAttemptAt;
    target.lastMessage = patch.lastMessage;
    if (patch.remainingUSDT !== undefined && kind === "safe_haven") {
      (target as RuntimeSafeHavenQueueItem).remainingUSDT =
        patch.remainingUSDT;
    }
    return true;
  });
}

/** Deletes one pending queue item by kind and id. */
async function removeItem(
  kind: "safe_haven" | "withdrawal",
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

// PROD:SAFE_HAVEN_SCHEDULE_QUEUE
/**
 * Creates queue items for due automatic Safe Haven schedules and stamps each
 * schedule's per-mode `lastQueuedAt` so the UTC month cannot double-queue.
 */
async function queueDueSafeHavenSchedules(
  catalog: RuntimeStorageCatalog,
  mode: RuntimeMode,
  now: number,
): Promise<number> {
  const config = catalog.config.runtime.safeHaven;
  if (!config?.autoEnabled) {
    return 0;
  }

  const due = config.schedules.filter(
    (schedule) =>
      schedule.enabled &&
      runtimeSafeHavenSchedule.timing.isDue(schedule, mode, now),
  );
  if (due.length === 0) {
    return 0;
  }

  const accountSlug =
    catalog.config.accounts[0]?.slug ?? DEFAULT_EXCHANGE_ACCOUNT_SLUG;
  const modeState = await runtimeStorage.account.load({
    accountSlug,
    mode,
  });
  const portfolioUSDT = runtimeAccountState.buildBalance({
    balance: modeState.balance,
    positions: modeState.positions,
  }).total;
  const period = queueStore.getUtcMonthKey(now);

  const outcome = await queueStore.mutateQueues((queues) => {
    const items: RuntimeSafeHavenQueueItem[] = [];
    const unstampedIds: string[] = [];
    for (const schedule of due) {
      if (
        queues.safeHaven.some(
          (item) => item.scheduleId === schedule.id && item.mode === mode,
        )
      ) {
        // A pending item already covers this month; self-heal the marker in
        // case a restart lost the stamp between create and update.
        if (!schedule.lastQueuedAt?.[mode]) {
          unstampedIds.push(schedule.id);
        }
        continue;
      }
      const amountUSDT = resolveScheduleAmountUSDT(
        schedule,
        portfolioUSDT,
      );
      if (!(amountUSDT > EPSILON_USDT)) {
        continue;
      }
      const item: RuntimeSafeHavenQueueItem = {
        account: accountSlug,
        id: `safe-haven-auto-${schedule.id}-${mode}`,
        kind: "safe_haven",
        mode,
        period,
        scheduleId: schedule.id,
        scheduleName: schedule.name,
        requestedUSDT: amountUSDT,
        remainingUSDT: amountUSDT,
        createdAt: now,
        nextAttemptAt: now,
        lastMessage: `Auto-queued ${amountUSDT} USDT from schedule "${schedule.name}" for ${mode} Safe Haven.`,
      };
      queues.safeHaven.push(item);
      items.push(item);
    }
    return { items, unstampedIds };
  });
  if (outcome.items.length === 0 && outcome.unstampedIds.length === 0) {
    return 0;
  }

  const stampedIds = new Set([
    ...outcome.items
      .map((item) => item.scheduleId)
      .filter((id): id is string => Boolean(id)),
    ...outcome.unstampedIds,
  ]);
  await runtimeStorage.catalog.update({
    account: accountSlug,
    safeHaven: {
      schedules: config.schedules.map((schedule) =>
        stampedIds.has(schedule.id)
          ? {
              ...schedule,
              lastQueuedAt: { ...schedule.lastQueuedAt, [mode]: now },
            }
          : schedule,
      ),
    },
  });

  if (outcome.items.length > 0) {
    modeState.balance.lastSafeHavenRequest = now;
    await runtimeStorage.account.save({
      accountSlug,
      mode,
      state: modeState,
    });
  }
  return outcome.items.length;
}

// PROD:WITHDRAW_QUEUE
/**
 * Creates queue items for due automatic withdrawal schedules and stamps each
 * schedule's `lastQueuedAt` so the UTC month cannot double-queue.
 */
async function queueDueWithdrawalSchedules(
  catalog: RuntimeStorageCatalog,
  now: number,
): Promise<number> {
  const config = catalog.config.runtime.withdrawal;
  if (!config?.autoEnabled) {
    return 0;
  }

  const due = config.schedules.filter(
    (schedule) =>
      schedule.enabled &&
      runtimeWithdrawalSchedule.timing.isDue(schedule, now),
  );
  if (due.length === 0) {
    return 0;
  }

  const outcome = await queueStore.mutateQueues((queues) => {
    const items: RuntimeWithdrawalQueueItem[] = [];
    const unstampedIds: string[] = [];
    for (const schedule of due) {
      const amountUSDT = Math.max(0, Number(schedule.amountUSDT) || 0);
      if (!(amountUSDT > EPSILON_USDT)) {
        continue;
      }
      if (
        queues.withdrawals.some(
          (item) => item.scheduleId === schedule.id,
        )
      ) {
        // A pending item already covers this month; self-heal the marker in
        // case a restart lost the stamp between create and update.
        if (!schedule.lastQueuedAt) {
          unstampedIds.push(schedule.id);
        }
        continue;
      }
      const { targetNetwork, targetWalletAddress } =
        queueStore.resolveWithdrawalTarget(config, schedule);
      const item: RuntimeWithdrawalQueueItem = {
        account: schedule.account,
        id: `withdrawal-auto-${schedule.id}`,
        kind: "withdrawal",
        scheduleId: schedule.id,
        scheduleName: schedule.name,
        amountUSDT,
        targetNetwork,
        targetWalletAddress,
        clientWithdrawId: `slow-${schedule.id}-${now}`.slice(0, 64),
        createdAt: now,
        nextAttemptAt: now,
        lastMessage: `Auto-queued withdrawal schedule "${schedule.name}" for ${amountUSDT} USDT.`,
      };
      queues.withdrawals.push(item);
      items.push(item);
    }
    return { items, unstampedIds };
  });
  if (outcome.items.length === 0 && outcome.unstampedIds.length === 0) {
    return 0;
  }

  const stampedIds = new Set([
    ...outcome.items.map((item) => item.scheduleId),
    ...outcome.unstampedIds,
  ]);
  const accountSlug =
    outcome.items[0]?.account ?? catalog.config.accounts[0]?.slug;
  await runtimeStorage.catalog.update({
    account: accountSlug,
    withdrawal: {
      schedules: config.schedules.map((schedule) =>
        stampedIds.has(schedule.id)
          ? { ...schedule, lastQueuedAt: now }
          : schedule,
      ),
    },
  });
  return outcome.items.length;
}

// PROD:SAFE_HAVEN_QUEUE
/**
 * Attempts one Safe Haven item: moves the safely spendable amount into the
 * virtual Safe Haven balance while keeping `minimalAssetOnTrade` and the
 * averaging reserve untouched. Partial moves keep the item pending.
 */
async function processSafeHavenItem(
  item: RuntimeSafeHavenQueueItem,
  mode: RuntimeMode,
  now: number,
  minimalAssetOnTrade: number,
): Promise<{ completed: boolean; movedUSDT: number }> {
  const modeState = await runtimeStorage.account.load({
    accountSlug: item.account,
    mode,
  });
  const memory = modeState.balance;
  const quoteAsset = finiteBalance(memory.quoteAsset);
  const reserved = finiteBalance(memory.reservedQuoteAsset);
  const safeHaven = finiteBalance(memory.safeHaven);
  const movable = Math.max(
    0,
    quoteAsset - Math.max(reserved, minimalAssetOnTrade),
  );
  const moved = Number(
    Math.min(item.remainingUSDT, movable).toFixed(8),
  );

  if (!(moved > EPSILON_USDT)) {
    await patchItemAttempt("safe_haven", item.id, {
      lastAttemptAt: now,
      nextAttemptAt: now + QUEUE_ATTEMPT_INTERVAL_MS,
      lastMessage:
        `Waiting for spendable trading balance — the ${mode} wallet holds ` +
        `${quoteAsset.toFixed(2)} USDT while ${item.remainingUSDT.toFixed(2)} ` +
        `USDT is still queued.`,
    });
    return { completed: false, movedUSDT: 0 };
  }

  const previousUSDT = safeHaven;
  const nextUSDT = Number((safeHaven + moved).toFixed(8));
  memory.quoteAsset = Number((quoteAsset - moved).toFixed(8));
  memory.safeHaven = nextUSDT;
  await runtimeStorage.account.save({
    accountSlug: item.account,
    mode,
    state: modeState,
  });
  await runtimeLogs.appendSafeHaven({
    account: item.account,
    mode,
    previousUSDT,
    nextUSDT,
    source: "queue",
    reason: item.scheduleName ?? "Queued Safe Haven request",
    timestamp: now,
  });

  const remaining = Number((item.remainingUSDT - moved).toFixed(8));
  if (!(remaining > EPSILON_USDT)) {
    await removeItem("safe_haven", item.id);
    return { completed: true, movedUSDT: moved };
  }

  await patchItemAttempt("safe_haven", item.id, {
    lastAttemptAt: now,
    nextAttemptAt: now,
    lastMessage:
      `Moved ${moved.toFixed(2)} of ${item.requestedUSDT.toFixed(2)} USDT ` +
      `into Safe Haven; ${remaining.toFixed(2)} USDT remaining.`,
    remainingUSDT: remaining,
  });
  return { completed: false, movedUSDT: moved };
}

/**
 * Books one funded withdrawal item in sandbox mode: reduces the virtual Safe
 * Haven balance and stamps the schedule without calling the exchange.
 */
async function executeSandboxWithdrawal(
  item: RuntimeWithdrawalQueueItem,
  mode: RuntimeMode,
  now: number,
  availableSafeHavenUSDT: number,
): Promise<void> {
  const catalog = await runtimeStorage.catalog.load();
  const withdrawal = catalog?.config.runtime.withdrawal;
  const nextUSDT = Number(
    Math.max(0, availableSafeHavenUSDT - item.amountUSDT).toFixed(8),
  );

  await runtimeStorage.catalog.update({
    account: item.account,
    safeHavenUSDT: nextUSDT,
    safeHavenLogReason: `Sandbox withdrawal schedule "${item.scheduleName}" executed`,
    safeHavenLogSource: "withdrawal",
    ...(withdrawal
      ? {
          withdrawal: {
            schedules: withdrawal.schedules.map((schedule) =>
              schedule.id === item.scheduleId
                ? {
                    ...schedule,
                    lastAttemptAt: now,
                    lastSuccessAt: now,
                    lastStatus: "EXECUTED:SANDBOX",
                  }
                : schedule,
            ),
          },
        }
      : {}),
  });

  await runtimeLogs.appendWithdrawal({
    account: item.account,
    trigger: "automatic",
    status: "executed",
    mode,
    scheduleId: item.scheduleId,
    scheduleName: item.scheduleName,
    amountUSDT: item.amountUSDT,
    availableSafeHavenUSDT,
    targetNetwork: item.targetNetwork,
    targetWalletAddress: item.targetWalletAddress,
    message:
      `Sandbox bookkeeping: moved ${item.amountUSDT} USDT out of the ` +
      `virtual Safe Haven for schedule "${item.scheduleName}".`,
    timestamp: now,
  });
}

// PROD:WITHDRAW_QUEUE
/**
 * Attempts one withdrawal item: all-or-nothing once Safe Haven holds the full
 * amount. Live submits the real exchange withdrawal reusing the item's stable
 * `clientWithdrawId`; sandbox performs bookkeeping only.
 */
async function processWithdrawalItem(
  item: RuntimeWithdrawalQueueItem,
  mode: RuntimeMode,
  now: number,
): Promise<boolean> {
  const modeState = await runtimeStorage.account.load({
    accountSlug: item.account,
    mode,
  });
  const availableSafeHavenUSDT = finiteBalance(modeState.balance.safeHaven);

  if (availableSafeHavenUSDT + EPSILON_USDT < item.amountUSDT) {
    await patchItemAttempt("withdrawal", item.id, {
      lastAttemptAt: now,
      nextAttemptAt: now + QUEUE_ATTEMPT_INTERVAL_MS,
      lastMessage:
        `Waiting for Safe Haven to reach ${item.amountUSDT.toFixed(2)} ` +
        `USDT (currently ${availableSafeHavenUSDT.toFixed(2)} USDT).`,
    });
    return false;
  }

  if (mode === "sandbox") {
    await executeSandboxWithdrawal(
      item,
      mode,
      now,
      availableSafeHavenUSDT,
    );
    await removeItem("withdrawal", item.id);
    return true;
  }

  try {
    const result = await runtimeWithdrawal.schedules.execute({
      clientWithdrawId: item.clientWithdrawId,
      logAttempts: false,
      scheduleId: item.scheduleId,
      trigger: "automatic",
    });

    await runtimeLogs.appendWithdrawal({
      account: item.account,
      trigger: "automatic",
      status: "executed",
      mode,
      scheduleId: item.scheduleId,
      scheduleName: item.scheduleName,
      amountUSDT: item.amountUSDT,
      availableSafeHavenUSDT,
      targetNetwork: item.targetNetwork,
      targetWalletAddress: item.targetWalletAddress,
      message: result.message,
      timestamp: now,
      ...(result.withdrawId ? { withdrawId: result.withdrawId } : {}),
    });
    await removeItem("withdrawal", item.id);
    return true;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    const messageChanged = message !== item.lastMessage;
    await patchItemAttempt("withdrawal", item.id, {
      lastAttemptAt: now,
      nextAttemptAt: now + QUEUE_ATTEMPT_INTERVAL_MS,
      lastMessage: message,
    });
    if (messageChanged) {
      await runtimeLogs.appendWithdrawal({
        account: item.account,
        trigger: "automatic",
        status: "failed",
        mode,
        scheduleId: item.scheduleId,
        scheduleName: item.scheduleName,
        amountUSDT: item.amountUSDT,
        availableSafeHavenUSDT,
        targetNetwork: item.targetNetwork,
        targetWalletAddress: item.targetWalletAddress,
        message,
        timestamp: now,
      });
    }
    return false;
  }
}

/**
 * Keeps `balance.safeHavenRequest` equal to the sum of pending Safe Haven
 * amounts for every account/mode touched by this pass.
 */
async function syncSafeHavenRequests(
  queues: RuntimeQueues,
  touched: Set<string>,
): Promise<void> {
  for (const item of queues.safeHaven) {
    touched.add(`${item.account}:${item.mode}`);
  }

  const latest = await queueStore.loadQueues();
  for (const key of touched) {
    const [accountSlug, itemMode] = key.split(":");
    const pending = latest.safeHaven.reduce(
      (total, item) =>
        total +
        (item.account === accountSlug && item.mode === itemMode
          ? item.remainingUSDT
          : 0),
      0,
    );
    const next = Number(pending.toFixed(8));
    const modeState = await runtimeStorage.account.load({
      accountSlug,
      mode: itemMode as RuntimeMode,
    });
    if (modeState.balance.safeHavenRequest !== next) {
      modeState.balance.safeHavenRequest = next;
      await runtimeStorage.account.save({
        accountSlug,
        mode: itemMode as RuntimeMode,
        state: modeState,
      });
    }
  }
}

// PROD:SAFE_HAVEN_SCHEDULE_QUEUE
// PROD:SAFE_HAVEN_QUEUE
// PROD:WITHDRAW_QUEUE
/**
 * Runs one management-pass queue sweep: auto-creates items for due schedules,
 * then attempts Safe Haven items before withdrawal items for the active mode.
 */
async function run(params: {
  mode: RuntimeMode;
  now?: number;
}): Promise<RuntimeQueueProcessSummary> {
  const mode = params.mode;
  const now = params.now ?? Date.now();
  const catalog = await runtimeStorage.catalog.load();
  if (!catalog) {
    return { completed: 0, movedUSDT: 0, queued: 0 };
  }

  const queued =
    (await queueDueSafeHavenSchedules(catalog, mode, now)) +
    (await queueDueWithdrawalSchedules(catalog, now));

  const queues = await queueStore.loadQueues();
  const touched = new Set<string>();
  const minimalAssetOnTrade = finiteBalance(
    catalog.config.management.minimalAssetOnTrade,
  );
  let completed = 0;
  let movedUSDT = 0;

  // Safe Haven items run first so funded withdrawals can proceed in the same
  // pass; each item belongs to the mode it was created for.
  for (const item of queues.safeHaven) {
    if (item.mode !== mode || item.nextAttemptAt > now) {
      continue;
    }
    touched.add(`${item.account}:${item.mode}`);
    const result = await processSafeHavenItem(
      item,
      mode,
      now,
      minimalAssetOnTrade,
    );
    movedUSDT += result.movedUSDT;
    if (result.completed) {
      completed += 1;
    }
  }

  for (const item of queues.withdrawals) {
    if (item.nextAttemptAt > now) {
      continue;
    }
    if (await processWithdrawalItem(item, mode, now)) {
      completed += 1;
    }
  }

  await syncSafeHavenRequests(queues, touched);
  return { completed, movedUSDT, queued };
}

const queueProcess = {
  run,
} as const;

export default queueProcess;
