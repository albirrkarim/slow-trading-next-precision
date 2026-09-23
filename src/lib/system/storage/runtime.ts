import path from "path";

import fs from "fs-extra";

import type { BlackSwanState } from "../trading/black-swan";
import type {
  RuntimeCyclePerformanceSummary,
  RuntimeStageRunStatsMap,
} from "../runtime/stages";
import vpoints from "../utils/vpoints";
import type { Position, RuntimeHistoryPosition } from "../trading";
import type { ExchangeType, VolatilityPoint } from "../types";
import runtimeCatalog from "./catalog";
import jsonFile from "./json-file";
import storageFiles from "./files";

import type { RuntimeMode } from "../runtime/types";

export type { RuntimeMode } from "../runtime/types";

/**
 * Account-owned balance memory persisted at
 * `accounts/<slug>/<mode>/balance.json`. Field names follow the current
 * on-disk shape; unknown extra fields are preserved.
 */
export interface RuntimeBalanceMemory extends Record<string, unknown> {
  startingBalanceUSDT?: number;
  quoteAsset?: number;
  reservedQuoteAsset?: number;
  safeHaven?: number;
  /** Sum of pending Safe Haven queue amounts for this account/mode. */
  safeHavenRequest?: number;
  /** Timestamp of the latest queued Safe Haven request. */
  lastSafeHavenRequest?: number;
}

/** Account-owned positions + balance for one mode. */
export interface RuntimeAccountModeState {
  positions: Position[];
  balance: RuntimeBalanceMemory;
}

/**
 * Global per-mode runtime status persisted in `status.json[mode]`. Nothing
 * writes this slice yet — the dashboard reads it when a producer lands.
 */
export interface RuntimeSystemStatus {
  blackSwan?: BlackSwanState;
  dailyPnlLimitState?: {
    /** UTC day key. */
    d: string;
    /** Combined net closed-trade PnL in USDT across all accounts. */
    usdt: number;
  };
  /** Per-channel daily-PnL-stop notification transition state. */
  dailyPnlLimitNotified?: Record<string, { b: boolean; d: string }>;
  /** Per-channel completed-day performance report markers. */
  dailyPerformanceNotified?: Record<string, string>;
  lastRunAt?: number;
  lastRunDurationMs?: number;
  lastRunPerformance?: RuntimeCyclePerformanceSummary;
  lastRunSummary?: string;
  stageRuns?: RuntimeStageRunStatsMap;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function readJsonFile(filePath: string): Promise<unknown> {
  if (!(await fs.pathExists(filePath))) {
    return undefined;
  }

  return fs.readJSON(filePath).catch(() => undefined);
}

/** Loads one account's owned positions + balance for one mode. */
async function loadAccountMode(params: {
  accountSlug: string;
  mode: RuntimeMode;
}): Promise<RuntimeAccountModeState> {
  const files = storageFiles.prod.account(params.accountSlug, params.mode);
  const [positions, balance] = await Promise.all([
    readJsonFile(files.positions),
    readJsonFile(files.balance),
  ]);

  return {
    positions: Array.isArray(positions) ? (positions as Position[]) : [],
    balance: isRecord(balance) ? balance : {},
  };
}

/** Atomically persists one account's owned positions + balance. */
async function saveAccountMode(params: {
  accountSlug: string;
  mode: RuntimeMode;
  state: RuntimeAccountModeState;
}): Promise<void> {
  const files = storageFiles.prod.account(params.accountSlug, params.mode);
  await Promise.all([
    jsonFile.write.atomic(files.positions, params.state.positions),
    jsonFile.write.atomic(files.balance, params.state.balance),
  ]);
}

/** Loads the global runtime status slice for one mode; `{}` when absent. */
async function loadStatus(mode: RuntimeMode): Promise<RuntimeSystemStatus> {
  const raw = await readJsonFile(storageFiles.prod.status);
  const slice = isRecord(raw) ? raw[mode] : undefined;
  return isRecord(slice) ? (slice as RuntimeSystemStatus) : {};
}

/** Atomically replaces the global runtime status slice for one mode. */
async function saveStatus(
  mode: RuntimeMode,
  state: RuntimeSystemStatus,
): Promise<void> {
  await jsonFile.update.atomic(storageFiles.prod.status, (raw) => ({
    ...(isRecord(raw) ? raw : {}),
    [mode]: state,
  }));
}

/**
 * Atomically reads, mutates, and persists the global runtime status slice for
 * one mode. Serialized per file so concurrent mutations never interleave.
 */
async function updateStatus(
  mode: RuntimeMode,
  mutate: (state: RuntimeSystemStatus) => RuntimeSystemStatus | void,
): Promise<RuntimeSystemStatus> {
  let nextState: RuntimeSystemStatus = {};
  await jsonFile.update.atomic(storageFiles.prod.status, (raw) => {
    const file = isRecord(raw) ? raw : {};
    const current = isRecord(file[mode]) ? (file[mode] as RuntimeSystemStatus) : {};
    const next = { ...current };
    const result = mutate(next);
    nextState = isRecord(result) ? (result as RuntimeSystemStatus) : next;
    return { ...file, [mode]: nextState };
  });
  return nextState;
}

function historyPositionKey(symbol: string, position: Position): string {
  return [
    position.account,
    symbol,
    position.opened.vPoint.id,
    position.opened.t,
    position.closed?.t ?? "",
    position.exposure.quantity,
    position.exposure.notionalUsdt,
  ].join("|");
}

/**
 * Appends one closed position to the shared mode history file for its symbol.
 * Rows keep their own `account` field; identical rows are deduplicated by the
 * history identity key.
 */
async function appendHistory(params: {
  mode: RuntimeMode;
  position: Position;
}): Promise<void> {
  const { mode, position } = params;
  if (!position.closed?.t) {
    throw new Error("Only closed positions can be appended to history.");
  }
  if (!storageFiles.isValidAccountSlug(position.account)) {
    throw new Error(
      `Invalid account slug on history position: ${position.account}`,
    );
  }

  const symbol = position.symbol.toUpperCase();
  await jsonFile.update.atomic<Position[]>(
    storageFiles.prod.historyFile(mode, symbol),
    (raw) => {
      const existing = Array.isArray(raw) ? (raw as Position[]) : [];
      const key = historyPositionKey(symbol, position);
      if (
        existing.some(
          (current) => historyPositionKey(symbol, current) === key,
        )
      ) {
        return existing;
      }

      return [...existing, structuredClone(position)].sort(
        (left, right) => (left.opened.t ?? 0) - (right.opened.t ?? 0),
      );
    },
  );
}

/** Lists the symbols persisted under `prod/history/<mode>/`. */
async function listHistorySymbols(mode: RuntimeMode): Promise<string[]> {
  const entries = await fs
    .readdir(storageFiles.prod.history(mode), { withFileTypes: true })
    .catch(() => []);

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.basename(entry.name, ".json").toUpperCase())
    .filter(Boolean);
}

/** Reads the shared mode history file for one symbol. */
async function readSharedHistoryFile(
  mode: RuntimeMode,
  symbol: string,
): Promise<Position[]> {
  const raw = await readJsonFile(
    storageFiles.prod.historyFile(mode, symbol.toUpperCase()),
  );
  return Array.isArray(raw) ? (raw as Position[]) : [];
}

/**
 * Reads closed positions whose closing time falls within the half-open range
 * `[startTime, endTime)`. Rows are shared across accounts; `account` narrows
 * the result to one account slug when provided. Sorted by closing time.
 */
async function readHistoryRange(params: {
  account?: string;
  endTime: number;
  mode: RuntimeMode;
  startTime: number;
}): Promise<Position[]> {
  const account = params.account?.trim() || null;
  const history: Position[] = [];

  for (const symbol of await listHistorySymbols(params.mode)) {
    const positions = await readSharedHistoryFile(params.mode, symbol);
    history.push(
      ...positions.filter((position) => {
        if (account && position.account !== account) return false;
        const closedAt = position.closed?.t;
        return (
          typeof closedAt === "number" &&
          Number.isFinite(closedAt) &&
          closedAt >= params.startTime &&
          closedAt < params.endTime
        );
      }),
    );
  }

  return history.sort(
    (left, right) => (left.closed?.t ?? 0) - (right.closed?.t ?? 0),
  );
}

/**
 * Reads every closed position persisted under `prod/history/<mode>/`,
 * decorated with the owning mode and sorted by entry time. `account` narrows
 * the result to one account slug when provided.
 */
async function readAllHistory(
  mode: RuntimeMode,
  options: { account?: string } = {},
): Promise<RuntimeHistoryPosition[]> {
  const account = options.account?.trim() || null;
  const history: RuntimeHistoryPosition[] = [];

  for (const symbol of await listHistorySymbols(mode)) {
    const positions = await readSharedHistoryFile(mode, symbol);
    history.push(
      ...positions
        .filter((position) => !account || position.account === account)
        .map((position) => ({ ...position, mode })),
    );
  }

  return history.sort(
    (left, right) => (left.opened.t ?? 0) - (right.opened.t ?? 0),
  );
}

/** Deletes every persisted history file for one mode. */
async function clearHistory(
  mode: RuntimeMode,
): Promise<{ deletedCount: number }> {
  let deletedCount = 0;
  for (const symbol of await listHistorySymbols(mode)) {
    const positions = await readSharedHistoryFile(mode, symbol);
    deletedCount += positions.length;
    await fs.remove(storageFiles.prod.historyFile(mode, symbol));
  }

  return { deletedCount };
}

/** Row identity used to match one persisted history entry. */
export interface RuntimeHistoryEntryIdentity {
  account: string;
  entryId?: string;
  entryTime?: number;
  exitTime?: number;
  quantity?: number;
  usdt?: number;
}

/**
 * Checks whether one persisted position matches a caller-supplied identity.
 * Symbol is already constrained by the file, so matching keys on account plus
 * whichever optional fields were provided — preferring the exact entry id.
 */
function historyPositionMatches(
  position: Position,
  target: RuntimeHistoryEntryIdentity,
): boolean {
  if (position.account !== target.account) return false;

  if (
    typeof target.entryId === "string" &&
    target.entryId.trim().length > 0 &&
    String(position.opened.vPoint.id || "") !== target.entryId
  ) {
    return false;
  }

  if (
    typeof target.entryTime === "number" &&
    Number(position.opened.t ?? NaN) !== target.entryTime
  ) {
    return false;
  }

  if (
    typeof target.exitTime === "number" &&
    Number(position.closed?.t ?? NaN) !== target.exitTime
  ) {
    return false;
  }

  if (
    typeof target.quantity === "number" &&
    Math.abs(Number(position.exposure.quantity ?? 0) - target.quantity) > 1e-9
  ) {
    return false;
  }

  if (
    typeof target.usdt === "number" &&
    Math.abs(Number(position.exposure.notionalUsdt ?? 0) - target.usdt) > 1e-9
  ) {
    return false;
  }

  return true;
}

/** Deletes the first matching history row from the shared symbol file. */
async function deleteHistoryEntry(
  mode: RuntimeMode,
  symbol: string,
  identity: RuntimeHistoryEntryIdentity,
): Promise<{ deleted: boolean }> {
  let deleted = false;
  await jsonFile.update.atomic<Position[]>(
    storageFiles.prod.historyFile(mode, symbol.toUpperCase()),
    (raw) => {
      const current = Array.isArray(raw) ? (raw as Position[]) : [];
      const next: Position[] = [];
      for (const position of current) {
        if (!deleted && historyPositionMatches(position, identity)) {
          deleted = true;
          continue;
        }
        next.push(position);
      }
      return next;
    },
  );

  return { deleted };
}

/**
 * Updates the optional note on the first matching history row. An empty note
 * removes the field from the persisted position.
 */
async function updateHistoryNotes(
  mode: RuntimeMode,
  symbol: string,
  identity: RuntimeHistoryEntryIdentity & { notes: string },
): Promise<{ updated: boolean }> {
  let updated = false;
  const normalizedNotes = identity.notes.trim();
  await jsonFile.update.atomic<Position[]>(
    storageFiles.prod.historyFile(mode, symbol.toUpperCase()),
    (raw) => {
      const current = Array.isArray(raw) ? (raw as Position[]) : [];
      return current.map((position) => {
        if (updated || !historyPositionMatches(position, identity)) {
          return position;
        }

        updated = true;
        const next = { ...position };
        if (normalizedNotes) {
          next.notes = normalizedNotes;
        } else {
          delete next.notes;
        }
        return next;
      });
    },
  );

  return { updated };
}

/** Reads the persisted vPoint list for one exchange/symbol. */
async function readVPoints(params: {
  exchangeType: ExchangeType;
  symbol: string;
}): Promise<VolatilityPoint[]> {
  const raw = await readJsonFile(
    storageFiles.prod.volatilityFile(
      params.exchangeType,
      params.symbol.toUpperCase(),
    ),
  );

  return isRecord(raw) && Array.isArray(raw.lastVolatility)
    ? (raw.lastVolatility as VolatilityPoint[])
    : [];
}

/**
 * Atomically merges vPoints into one symbol's persisted volatility file.
 * Points merge by `id` — the full detected history on disk is preserved while
 * runtime mutations (`usedBy<accountSlug>` markers, new points) write through.
 * Unknown top-level fields already on disk are preserved.
 */
async function mergeVPoints(params: {
  exchangeType: ExchangeType;
  symbol: string;
  points: VolatilityPoint[];
}): Promise<void> {
  const symbol = params.symbol.toUpperCase();
  await jsonFile.update.atomic(
    storageFiles.prod.volatilityFile(params.exchangeType, symbol),
    (current) => {
      const persisted = isRecord(current) ? current : undefined;
      const existing = Array.isArray(persisted?.lastVolatility)
        ? (persisted.lastVolatility as VolatilityPoint[])
        : [];

      return {
        ...persisted,
        symbol,
        lastVolatility: vpoints.mergeById(existing, params.points),
      };
    },
  );
}

/** Grouped runtime storage operations over the persistent layout. */
const runtimeStorage = {
  catalog: runtimeCatalog,
  account: {
    load: loadAccountMode,
    save: saveAccountMode,
  },
  status: {
    load: loadStatus,
    save: saveStatus,
    update: updateStatus,
  },
  history: {
    append: appendHistory,
    clear: clearHistory,
    deleteEntry: deleteHistoryEntry,
    listSymbols: listHistorySymbols,
    readAll: readAllHistory,
    readRange: readHistoryRange,
    readSymbol: readSharedHistoryFile,
    updateNotes: updateHistoryNotes,
  },
  vpoints: {
    merge: mergeVPoints,
    read: readVPoints,
  },
} as const;

export default runtimeStorage;
