import fs from "fs-extra";
import { DEFAULT_EXCHANGE_ACCOUNT_SLUG } from "@/lib/exchange/account-context";
import type {
  RuntimeWithdrawalConfig,
  RuntimeWithdrawalSchedule,
} from "../runtime/types";
import { runtimeStorage } from "../storage";
import jsonFile from "../storage/json-file";
import storageFiles from "../storage/files";
import type {
  RuntimeQueues,
  RuntimeSafeHavenQueueItem,
  RuntimeWithdrawalQueueItem,
} from "./types";

/** Creates an empty queue payload for new installations. */
function createEmpty(): RuntimeQueues {
  return {
    safeHaven: [],
    withdrawals: [],
  };
}

/** Normalizes a timestamp into a positive millisecond value. */
function normalizeTime(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Normalizes one Safe Haven queue item loaded from disk. */
function normalizeSafeHavenQueueItem(
  value: unknown,
  fallbackMode: string,
): RuntimeSafeHavenQueueItem | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const raw = value as Partial<RuntimeSafeHavenQueueItem>;
  const id = String(raw.id ?? "").trim();
  const period = String(raw.period ?? "").trim();
  const requestedUSDT = Math.max(0, Number(raw.requestedUSDT) || 0);
  const remainingUSDT = Math.min(
    requestedUSDT,
    Math.max(0, Number(raw.remainingUSDT) || 0),
  );
  const createdAt = normalizeTime(raw.createdAt, Date.now());

  if (!id || !period || !(requestedUSDT > 0) || !(remainingUSDT > 0)) {
    return null;
  }

  return {
    id,
    account:
      String(raw.account ?? "").trim() || DEFAULT_EXCHANGE_ACCOUNT_SLUG,
    kind: "safe_haven",
    mode:
      raw.mode === "sandbox" || raw.mode === "live"
        ? raw.mode
        : fallbackMode === "sandbox"
          ? "sandbox"
          : "live",
    period,
    ...(String(raw.scheduleId ?? "").trim()
      ? { scheduleId: String(raw.scheduleId).trim() }
      : {}),
    ...(String(raw.scheduleName ?? "").trim()
      ? { scheduleName: String(raw.scheduleName).trim() }
      : {}),
    requestedUSDT,
    remainingUSDT,
    createdAt,
    nextAttemptAt: normalizeTime(raw.nextAttemptAt, createdAt),
    lastMessage:
      String(raw.lastMessage ?? "").trim() ||
      "Waiting for the first Safe Haven attempt.",
    ...(Number(raw.lastAttemptAt) > 0
      ? { lastAttemptAt: Number(raw.lastAttemptAt) }
      : {}),
  };
}

/** Normalizes one withdrawal queue item loaded from disk. */
function normalizeWithdrawalQueueItem(
  value: unknown,
): RuntimeWithdrawalQueueItem | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const raw = value as Partial<RuntimeWithdrawalQueueItem>;
  const id = String(raw.id ?? "").trim();
  const scheduleId = String(raw.scheduleId ?? "").trim();
  const amountUSDT = Math.max(0, Number(raw.amountUSDT) || 0);
  const createdAt = normalizeTime(raw.createdAt, Date.now());

  if (!id || !scheduleId || !(amountUSDT > 0)) {
    return null;
  }

  return {
    id,
    account:
      String(raw.account ?? "").trim() || DEFAULT_EXCHANGE_ACCOUNT_SLUG,
    kind: "withdrawal",
    scheduleId,
    scheduleName:
      String(raw.scheduleName ?? "").trim() || "Withdrawal Schedule",
    amountUSDT,
    targetNetwork: String(raw.targetNetwork ?? "").trim().toUpperCase(),
    targetWalletAddress: String(raw.targetWalletAddress ?? "").trim(),
    clientWithdrawId:
      String(raw.clientWithdrawId ?? "").trim() ||
      `slow-queue-${id}`.slice(0, 64),
    createdAt,
    nextAttemptAt: normalizeTime(raw.nextAttemptAt, createdAt),
    lastMessage:
      String(raw.lastMessage ?? "").trim() ||
      "Waiting for the first withdrawal attempt.",
    ...(Number(raw.lastAttemptAt) > 0
      ? { lastAttemptAt: Number(raw.lastAttemptAt) }
      : {}),
  };
}

/** Normalizes the queue file while dropping invalid or completed rows. */
function normalizeQueues(
  value: unknown,
  fallbackMode: string,
): RuntimeQueues {
  const raw =
    value && typeof value === "object"
      ? (value as Partial<RuntimeQueues>)
      : {};

  return {
    safeHaven: Array.isArray(raw.safeHaven)
      ? raw.safeHaven
          .map((item) => normalizeSafeHavenQueueItem(item, fallbackMode))
          .filter((item): item is RuntimeSafeHavenQueueItem => Boolean(item))
      : [],
    withdrawals: Array.isArray(raw.withdrawals)
      ? raw.withdrawals
          .map(normalizeWithdrawalQueueItem)
          .filter(
            (item): item is RuntimeWithdrawalQueueItem => Boolean(item),
          )
      : [],
  };
}

/** Reads the persistent queue file. */
async function loadQueues(): Promise<RuntimeQueues> {
  if (!(await fs.pathExists(storageFiles.prod.queue))) {
    return createEmpty();
  }

  const catalog = await runtimeStorage.catalog.load().catch(() => null);
  const raw = await fs
    .readJSON(storageFiles.prod.queue)
    .catch(() => createEmpty());
  return normalizeQueues(raw, catalog?.mode ?? "live");
}

/** Mutates and persists the latest queue payload, returning the mutation result. */
async function mutateQueues<T>(
  mutation: (queues: RuntimeQueues) => T | Promise<T>,
): Promise<T> {
  const catalog = await runtimeStorage.catalog.load().catch(() => null);
  const fallbackMode = catalog?.mode ?? "live";
  let result!: T;

  await jsonFile.update.atomic(storageFiles.prod.queue, (current) => {
    const queues = normalizeQueues(current, fallbackMode);
    const next = mutation(queues);
    if (next instanceof Promise) {
      throw new Error("Queue mutations must be synchronous.");
    }
    result = next;
    return queues;
  });

  return result;
}

/** Formats a timestamp as the UTC month key used by Safe Haven queues. */
function getUtcMonthKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Resolves a schedule's wallet-book override or inline withdrawal target. */
function resolveWithdrawalTarget(
  withdrawal: RuntimeWithdrawalConfig | undefined,
  schedule: RuntimeWithdrawalSchedule,
): { targetNetwork: string; targetWalletAddress: string } {
  const wallet = schedule.walletId
    ? withdrawal?.walletBook.find(
        (candidate) => candidate.id === schedule.walletId,
      )
    : undefined;

  return {
    targetNetwork: String(wallet?.network ?? schedule.targetNetwork)
      .trim()
      .toUpperCase(),
    targetWalletAddress: String(
      wallet?.address ?? schedule.targetWalletAddress,
    ).trim(),
  };
}

const queueStore = {
  createEmpty,
  getUtcMonthKey,
  loadQueues,
  mutateQueues,
  normalizeQueues,
  resolveWithdrawalTarget,
} as const;

export default queueStore;
