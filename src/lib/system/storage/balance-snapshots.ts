import fs from "fs-extra";
import { systemLog } from "../logging";
import type { RuntimeMode } from "../runtime/types";
import storageFiles from "./files";
import jsonFile from "./json-file";

/** Daily balance snapshot used for the dashboard balance timeline. */
export interface RuntimeBalanceSnapshot {
  /** UTC day key in YYYY-MM-DD format. */
  day: string;
  /** Snapshot timestamp in milliseconds. */
  timestamp: number;
  /** Total account value estimate for the day. */
  total: number;
}

function getAccountBalanceSnapshotsFile(params: {
  account: string;
  mode: RuntimeMode;
}): string {
  return storageFiles.prod.account(params.account, params.mode)
    .balanceSnapshots;
}

/** Normalizes persisted snapshots into the canonical snapshot shape. */
function normalizeBalanceSnapshots(raw: unknown): RuntimeBalanceSnapshot[] {
  if (!Array.isArray(raw)) return [];

  return (raw as RuntimeBalanceSnapshot[])
    .filter(
      (snapshot) =>
        typeof snapshot?.day === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(snapshot.day) &&
        typeof snapshot?.timestamp === "number" &&
        Number.isFinite(snapshot.timestamp) &&
        typeof snapshot?.total === "number" &&
        Number.isFinite(snapshot.total),
    )
    .sort((left, right) => left.day.localeCompare(right.day));
}

async function readBalanceSnapshotsFile(
  filePath: string,
): Promise<RuntimeBalanceSnapshot[]> {
  if (!(await fs.pathExists(filePath))) return [];
  return normalizeBalanceSnapshots(await fs.readJSON(filePath));
}

/** Reads one account's persisted UTC-day balance snapshots in day order. */
async function read(params: {
  account: string;
  mode: RuntimeMode;
}): Promise<RuntimeBalanceSnapshot[]> {
  return readBalanceSnapshotsFile(getAccountBalanceSnapshotsFile(params));
}

/**
 * Sums account snapshots by UTC day, carrying each account's latest known
 * balance forward only after that account has produced its first snapshot.
 */
function aggregate(
  accountSnapshots: readonly (readonly RuntimeBalanceSnapshot[])[],
): RuntimeBalanceSnapshot[] {
  const series = accountSnapshots.map((snapshots) =>
    normalizeBalanceSnapshots(snapshots),
  );
  const days = Array.from(
    new Set(series.flatMap((snapshots) => snapshots.map(({ day }) => day))),
  ).sort((left, right) => left.localeCompare(right));
  const indexes = series.map(() => 0);
  const latest = series.map<RuntimeBalanceSnapshot | undefined>(
    () => undefined,
  );

  return days.map((day) => {
    let timestamp = 0;
    let total = 0;

    series.forEach((snapshots, seriesIndex) => {
      while (
        indexes[seriesIndex]! < snapshots.length &&
        snapshots[indexes[seriesIndex]!]!.day <= day
      ) {
        const snapshot = snapshots[indexes[seriesIndex]!]!;
        latest[seriesIndex] = snapshot;
        indexes[seriesIndex]! += 1;
        if (snapshot.day === day) {
          timestamp = Math.max(timestamp, snapshot.timestamp);
        }
      }

      total += latest[seriesIndex]?.total ?? 0;
    });

    return { day, timestamp, total };
  });
}

/**
 * Reads and aggregates the selected account snapshots. Carries each account's
 * latest known balance forward once that account has produced its first
 * snapshot.
 */
async function readCombined(params: {
  accounts: readonly string[];
  mode: RuntimeMode;
}): Promise<RuntimeBalanceSnapshot[]> {
  const accountSnapshots = await Promise.all(
    Array.from(new Set(params.accounts)).map((account) =>
      read({ account, mode: params.mode }),
    ),
  );

  return aggregate(accountSnapshots);
}

/** Upserts one account-scoped balance snapshot per UTC day. */
async function upsert(params: {
  account: string;
  mode: RuntimeMode;
  total: number;
  timestamp?: number;
}): Promise<void> {
  try {
    const timestamp = params.timestamp ?? Date.now();
    const day = new Date(timestamp).toISOString().slice(0, 10);
    const historyFile = getAccountBalanceSnapshotsFile(params);

    await jsonFile.update.atomic(historyFile, (raw) => {
      const history = normalizeBalanceSnapshots(raw);
      const nextSnapshot: RuntimeBalanceSnapshot = {
        day,
        timestamp,
        total: params.total,
      };
      const existingIndex = history.findIndex(
        (snapshot) => snapshot.day === day,
      );

      if (existingIndex >= 0) {
        history[existingIndex] = nextSnapshot;
      } else {
        history.push(nextSnapshot);
      }

      return history.sort((left, right) => left.day.localeCompare(right.day));
    });
  } catch (error) {
    systemLog.error("[storage] Failed to upsert balance snapshot", error);
  }
}

/** Grouped balance-snapshot persistence over the persistent layout. */
const runtimeBalanceSnapshots = {
  aggregate,
  read,
  readCombined,
  upsert,
} as const;

export default runtimeBalanceSnapshots;
export { runtimeBalanceSnapshots };
