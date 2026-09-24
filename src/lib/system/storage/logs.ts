import fs from "fs-extra";

import type {
  BinanceCooldownState,
  BinanceRequestKind,
} from "@/lib/exchange/platform/binance/request-coordinator";
import type { RuntimeMode } from "../runtime/types";
import storageFiles from "./files";
import jsonFile from "./json-file";
import sanitize from "./sanitize";

/** Persistent operational error log triage state. */
export type RuntimeErrorStatus = "new" | "dismissed" | "solved";

/** Persistent operational error log entry. */
export interface RuntimeErrorLogEntry {
  id: string;
  createdAt: number;
  source: string;
  status: RuntimeErrorStatus;
  message: string;
  stack?: string;
  details?: Record<string, unknown>;
}

/** One persistent Binance REST cooldown incident. */
export interface RuntimeBinanceCooldownLogEntry {
  id: string;
  t: number;
  end: number;
  /** Exchange-communicated ban end before the spare settle window. */
  banEnd?: number;
  /** Spare settle window appended after an IP ban, in milliseconds. */
  settle?: number;
  endpoint: string;
  kind: BinanceRequestKind;
  reason: string;
  occurrences: number;
  code?: number | string;
  status?: number;
}

/** Binance runtime health rendered by the dashboard and MCP. */
export interface RuntimeBinanceHealthSnapshot {
  current: BinanceCooldownState | null;
  logs: RuntimeBinanceCooldownLogEntry[];
}

/** Result of one atomic error-log status transition. */
export interface RuntimeErrorStatusUpdateResult {
  missingIds: string[];
  updated: RuntimeErrorLogEntry[];
}

/** Persistent configured-symbol management audit entry. */
export interface RuntimeManagementLogEntry {
  id: string;
  createdAt: number;
  action: "add" | "remove";
  symbol: string;
  source: string;
  reason: string;
}

/** One flattened leaf difference inside a config change record. */
export interface RuntimeConfigChange {
  path: string;
  previous?: unknown;
  next?: unknown;
}

/** Persistent config change audit entry — one record per save. */
export interface RuntimeConfigLogEntry {
  id: string;
  createdAt: number;
  changes: RuntimeConfigChange[];
  source: string;
}

/** Persistent Safe Haven balance-change log entry. */
export interface RuntimeSafeHavenLogEntry {
  id: string;
  account: string;
  createdAt: number;
  mode: RuntimeMode;
  previousUSDT: number;
  nextUSDT: number;
  deltaUSDT: number;
  source: string;
  reason?: string;
}

/** Persistent withdrawal audit log entry. */
export interface RuntimeWithdrawalLogEntry {
  id: string;
  account: string;
  createdAt: number;
  trigger: "manual" | "automatic";
  status: "attempted" | "skipped" | "failed" | "executed";
  mode: RuntimeMode;
  scheduleId: string;
  scheduleName?: string;
  amountUSDT?: number;
  availableSafeHavenUSDT?: number;
  targetNetwork?: string;
  targetWalletAddress?: string;
  message: string;
  withdrawId?: string;
}

/** Grouped runtime logs returned to the dashboard. */
export interface RuntimeLogs {
  binanceCooldowns?: RuntimeBinanceCooldownLogEntry[];
  config: RuntimeConfigLogEntry[];
  errors: RuntimeErrorLogEntry[];
  management: RuntimeManagementLogEntry[];
  safeHaven: RuntimeSafeHavenLogEntry[];
  withdrawals: RuntimeWithdrawalLogEntry[];
}

/** Persistent log collection exposed by the dashboard API. */
export type RuntimeLogKind =
  | "config"
  | "errors"
  | "management"
  | "safe_haven"
  | "withdrawals";

const MAX_LOG_ENTRIES = 500;

function createLogId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Converts arbitrary detail payloads into a JSON-safe record. */
function toJsonSafeDetails(
  value: unknown,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  try {
    return structuredClone(value as Record<string, unknown>);
  } catch {
    return { value: String(value) };
  }
}

/** Converts arbitrary values into a JSON-safe clone. */
function toJsonSafeValue(value: unknown): unknown {
  try {
    return structuredClone(value);
  } catch {
    return String(value);
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown runtime error";
}

function getErrorStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined;
}

async function readLogFile<T>(filePath: string): Promise<T[]> {
  if (!(await fs.pathExists(filePath))) {
    return [];
  }

  const raw = await fs.readJSON(filePath).catch(() => []);
  return Array.isArray(raw) ? (raw as T[]) : [];
}

async function appendLogFile<T extends { createdAt: number }>(
  filePath: string,
  entry: T,
): Promise<T[]> {
  return jsonFile.update.atomic<T[]>(filePath, (raw) => {
    const current = Array.isArray(raw) ? (raw as T[]) : [];
    return [...current, entry]
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(-MAX_LOG_ENTRIES);
  });
}

/** Gets the persistent file used by one dashboard log collection. */
function getLogFilePath(kind: RuntimeLogKind): string {
  const fileByKind: Record<RuntimeLogKind, string> = {
    config: storageFiles.prod.logs.config,
    errors: storageFiles.prod.logs.errors,
    management: storageFiles.prod.logs.management,
    safe_haven: storageFiles.prod.logs.safeHaven,
    withdrawals: storageFiles.prod.logs.withdrawals,
  };

  return fileByKind[kind];
}

// PROD:ERROR_LOG
/** Appends one operational error to the persistent error log. */
async function appendError(params: {
  source: string;
  error: unknown;
  details?: Record<string, unknown>;
  timestamp?: number;
}): Promise<RuntimeErrorLogEntry> {
  const entry: RuntimeErrorLogEntry = {
    id: createLogId("err"),
    createdAt: params.timestamp ?? Date.now(),
    source: params.source,
    status: "new",
    message: getErrorMessage(params.error),
    ...(getErrorStack(params.error) ? { stack: getErrorStack(params.error) } : {}),
    ...(params.details ? { details: toJsonSafeDetails(params.details) } : {}),
  };

  await appendLogFile(storageFiles.prod.logs.errors, entry);
  return entry;
}

// PROD:MANAGEMENT_LOG
/** Appends one configured-symbol management action to persistent storage. */
async function appendManagement(params: {
  action: "add" | "remove";
  symbol: string;
  source: string;
  reason: string;
  timestamp?: number;
}): Promise<RuntimeManagementLogEntry> {
  const entry: RuntimeManagementLogEntry = {
    id: createLogId("management"),
    createdAt: params.timestamp ?? Date.now(),
    action: params.action,
    symbol: String(params.symbol || "").trim().toUpperCase(),
    source: params.source,
    reason: params.reason,
  };

  await appendLogFile(storageFiles.prod.logs.management, entry);
  return entry;
}

// PROD:CONFIG_CHANGE_LOG
/** Appends one config save to persistent storage, masking credential values. */
async function appendConfig(params: {
  changes: RuntimeConfigChange[];
  source: string;
  timestamp?: number;
}): Promise<RuntimeConfigLogEntry> {
  const entry: RuntimeConfigLogEntry = {
    id: createLogId("config"),
    createdAt: params.timestamp ?? Date.now(),
    changes: params.changes.map((change) => {
      const sensitive = sanitize.isSensitivePath(change.path);
      return {
        path: change.path,
        ...(change.previous === undefined
          ? {}
          : {
              previous: sensitive
                ? sanitize.MASKED_VALUE
                : sanitize.maskSecrets(toJsonSafeValue(change.previous)),
            }),
        ...(change.next === undefined
          ? {}
          : {
              next: sensitive
                ? sanitize.MASKED_VALUE
                : sanitize.maskSecrets(toJsonSafeValue(change.next)),
            }),
      };
    }),
    source: params.source,
  };

  await appendLogFile(storageFiles.prod.logs.config, entry);
  return entry;
}

// PROD:SAFE_HAVEN_LOG
/** Appends one Safe Haven balance change to persistent storage. */
async function appendSafeHaven(params: {
  account: string;
  mode: RuntimeMode;
  previousUSDT: number;
  nextUSDT: number;
  source: string;
  reason?: string;
  timestamp?: number;
}): Promise<RuntimeSafeHavenLogEntry> {
  const previousUSDT = Number(params.previousUSDT) || 0;
  const nextUSDT = Number(params.nextUSDT) || 0;
  const entry: RuntimeSafeHavenLogEntry = {
    id: createLogId("safe-haven"),
    account: params.account,
    createdAt: params.timestamp ?? Date.now(),
    mode: params.mode,
    previousUSDT,
    nextUSDT,
    deltaUSDT: Number((nextUSDT - previousUSDT).toFixed(8)),
    source: params.source,
    ...(params.reason ? { reason: params.reason } : {}),
  };

  await appendLogFile(storageFiles.prod.logs.safeHaven, entry);
  return entry;
}

// PROD:WITHDRAWAL_LOG
/** Appends one withdrawal audit entry to persistent storage. */
async function appendWithdrawal(
  params: Omit<RuntimeWithdrawalLogEntry, "id" | "createdAt"> & {
    timestamp?: number;
  },
): Promise<RuntimeWithdrawalLogEntry> {
  const entry: RuntimeWithdrawalLogEntry = {
    ...params,
    id: createLogId("withdrawal"),
    createdAt: params.timestamp ?? Date.now(),
  };

  await appendLogFile(storageFiles.prod.logs.withdrawals, entry);
  return entry;
}

/** Loads every persisted log collection, newest first. */
async function load(): Promise<RuntimeLogs> {
  const [binanceCooldowns, config, errors, management, safeHaven, withdrawals] =
    await Promise.all([
      readLogFile<RuntimeBinanceCooldownLogEntry>(
        storageFiles.prod.logs.binanceCooldowns,
      ),
      readLogFile<RuntimeConfigLogEntry>(storageFiles.prod.logs.config),
      readLogFile<RuntimeErrorLogEntry>(storageFiles.prod.logs.errors),
      readLogFile<RuntimeManagementLogEntry>(
        storageFiles.prod.logs.management,
      ),
      readLogFile<RuntimeSafeHavenLogEntry>(storageFiles.prod.logs.safeHaven),
      readLogFile<RuntimeWithdrawalLogEntry>(
        storageFiles.prod.logs.withdrawals,
      ),
    ]);

  return {
    binanceCooldowns: binanceCooldowns.sort((a, b) => b.t - a.t),
    config: config.sort((a, b) => b.createdAt - a.createdAt),
    errors: errors.sort((a, b) => b.createdAt - a.createdAt),
    management: management.sort((a, b) => b.createdAt - a.createdAt),
    safeHaven: safeHaven.sort((a, b) => b.createdAt - a.createdAt),
    withdrawals: withdrawals.sort((a, b) => b.createdAt - a.createdAt),
  };
}

/** Deletes one log record by its stable id. */
async function deleteEntry(
  kind: RuntimeLogKind,
  id: string,
): Promise<boolean> {
  let deleted = false;
  await jsonFile.update.atomic<unknown[]>(getLogFilePath(kind), (raw) => {
    const current = Array.isArray(raw) ? raw : [];
    const next = current.filter(
      (entry) =>
        !(entry && typeof entry === "object" && "id" in entry && entry.id === id),
    );
    deleted = next.length !== current.length;
    return next;
  });
  return deleted;
}

/** Deletes every record from one log collection. */
async function clear(kind: RuntimeLogKind): Promise<number> {
  let cleared = 0;
  await jsonFile.update.atomic<unknown[]>(getLogFilePath(kind), (raw) => {
    cleared = Array.isArray(raw) ? raw.length : 0;
    return [];
  });
  return cleared;
}

/** Updates error triage statuses without racing concurrent error appends. */
async function updateErrorStatuses(
  ids: string[],
  status: RuntimeErrorStatus,
): Promise<RuntimeErrorStatusUpdateResult> {
  const requestedIds = new Set(ids);
  let updated: RuntimeErrorLogEntry[] = [];
  let missingIds: string[] = [];

  await jsonFile.update.atomic<RuntimeErrorLogEntry[]>(
    storageFiles.prod.logs.errors,
    (raw) => {
      const current = Array.isArray(raw) ? raw : [];
      const existingIds = new Set(current.map((entry) => entry.id));
      missingIds = ids.filter((id) => !existingIds.has(id));
      if (missingIds.length > 0) {
        return current;
      }

      updated = current
        .filter((entry) => requestedIds.has(entry.id))
        .map((entry) => ({ ...entry, status }));
      const updatesById = new Map(updated.map((entry) => [entry.id, entry]));
      return current.map((entry) => updatesById.get(entry.id) ?? entry);
    },
  );

  return { missingIds, updated };
}

/** Grouped runtime log persistence over the persistent layout. */
const runtimeLogs = {
  appendConfig,
  appendError,
  appendManagement,
  appendSafeHaven,
  appendWithdrawal,
  clear,
  deleteEntry,
  load,
  updateErrorStatuses,
} as const;

export default runtimeLogs;
export { runtimeLogs };
