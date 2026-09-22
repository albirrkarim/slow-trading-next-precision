import { FILES } from "@/components/storage";
import fs from "fs-extra";
import type { Position } from "@/lib/trading/models";
import type { SlowTradingMode } from "../types";
import type { SlowTradingPersistedModeState } from "./internal-types";
import slowTradingJsonFile from "./json-file";

/** Persisted mode-state fields owned by `notifications.json`. */
export const MODE_STATE_NOTIFICATION_FIELDS = [
  "dailyPerformanceNotificationState",
  "dailyPnlLimitNotificationState",
  "highVolatilityNotificationState",
] as const satisfies readonly (keyof SlowTradingPersistedModeState)[];

/** Persisted mode-state fields owned by `status.json`. */
export const MODE_STATE_STATUS_FIELDS = [
  "blackSwan",
  "dailyPnlLimitState",
  "lastRunAt",
  "lastRunDurationMs",
  "lastRunPerformance",
  "lastRunSummary",
  "stageRuns",
] as const satisfies readonly (keyof SlowTradingPersistedModeState)[];

/** Copies the selected keys that are present on the persisted mode state. */
export function pickModeFields(
  state: Partial<SlowTradingPersistedModeState>,
  keys: readonly (keyof SlowTradingPersistedModeState)[],
): Partial<SlowTradingPersistedModeState> {
  const picked: Record<string, unknown> = {};
  for (const key of keys) {
    if (state[key] !== undefined) {
      picked[key] = state[key];
    }
  }

  return picked;
}

async function readJsonFile(filePath: string): Promise<unknown> {
  if (!(await fs.pathExists(filePath))) {
    return undefined;
  }

  return fs.readJSON(filePath).catch(() => undefined);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Reads one mode slice from a global `{mode: fields}` state file. */
export async function readKeyedModeFile(
  filePath: string,
  mode: SlowTradingMode,
): Promise<unknown> {
  const raw = await readJsonFile(filePath);
  return isRecord(raw) ? raw[mode] : undefined;
}

/** Atomically replaces one mode slice inside a global keyed state file. */
export async function writeKeyedModeFile(
  filePath: string,
  mode: SlowTradingMode,
  value: unknown,
): Promise<void> {
  await slowTradingJsonFile.update.atomic(filePath, (raw) => ({
    ...(isRecord(raw) ? raw : {}),
    [mode]: value,
  }));
}

/**
 * Loads every persisted piece of one account+mode and merges them back into
 * the flat persisted-mode-state shape consumed by `fromPersistedModeState`.
 * Positions/balance are account-owned; status/notifications come from the
 * global mode-keyed files (the account slug intentionally does not apply).
 */
export async function loadPersistedModeStateFiles(
  accountSlug: string,
  mode: SlowTradingMode,
): Promise<Partial<SlowTradingPersistedModeState>> {
  const files = FILES.prod.account(accountSlug, mode);
  const [positions, balance, status, notifications] = await Promise.all([
    readJsonFile(files.positions),
    readJsonFile(files.balance),
    readKeyedModeFile(FILES.prod.status, mode),
    readKeyedModeFile(FILES.prod.notifications, mode),
  ]);

  return {
    ...(status as Partial<SlowTradingPersistedModeState> | undefined),
    ...(notifications as Partial<SlowTradingPersistedModeState> | undefined),
    ...(balance !== undefined
      ? {
          dynamicTradeMemory:
            balance as SlowTradingPersistedModeState["dynamicTradeMemory"],
        }
      : {}),
    ...(Array.isArray(positions) ? { positions: positions as Position[] } : {}),
  };
}

/**
 * Persists one account+mode state: account-owned files for positions/balance,
 * global mode-keyed files for status/notifications. Status and notification
 * state are global system state — `dailyPnlLimitState` is computed across all
 * accounts' shared history, `blackSwan` uses global config + market evidence,
 * and run diagnostics describe the system cycle — so the mode slice is
 * replaced wholesale; sequential account execution keeps writes ordered.
 */
export async function savePersistedModeStateFiles(
  accountSlug: string,
  mode: SlowTradingMode,
  persisted: SlowTradingPersistedModeState,
): Promise<void> {
  const files = FILES.prod.account(accountSlug, mode);

  await slowTradingJsonFile.write.atomic(
    files.positions,
    persisted.positions ?? [],
  );
  await slowTradingJsonFile.write.atomic(
    files.balance,
    persisted.dynamicTradeMemory ?? {},
  );
  await writeKeyedModeFile(
    FILES.prod.status,
    mode,
    pickModeFields(persisted, MODE_STATE_STATUS_FIELDS),
  );
  await writeKeyedModeFile(
    FILES.prod.notifications,
    mode,
    pickModeFields(persisted, MODE_STATE_NOTIFICATION_FIELDS),
  );
}

/**
 * Removes every persisted file owned by one account. Global status and
 * notification state intentionally survive — they describe the system, not
 * the account (same as shared history rows).
 */
export async function deleteAccountStateFiles(
  accountSlug: string,
): Promise<void> {
  await fs.remove(FILES.prod.accountRoot(accountSlug));
}
