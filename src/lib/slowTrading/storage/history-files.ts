import { FILES } from "@/components/storage";
import type { Position } from "@/lib/trading/models";
import fs from "fs-extra";
import path from "path";
import { clone, normalizeSymbol } from "./common";
import type { HistoryPosition } from "./internal-types";
import slowTradingJsonFile from "./json-file";
import type {
  SlowTradingHistoryPosition,
  SlowTradingMode,
  SlowTradingModeState,
  SlowTradingStorageData,
} from "../types";

const ACCOUNT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface HydrateSlowTradingHistoryOptions {
  /** Restrict shared history hydration to one immutable account slug. */
  account?: string;
  /** Restrict hydration to one mode. Omit to hydrate both live and sandbox. */
  mode?: SlowTradingMode;
  /** Restrict hydration to these normalized symbols. Omit for all symbols. */
  symbols?: string[];
  /** Keep only positions closed at or after this timestamp. */
  fromTime?: number;
}

/**
 * Handles the history position key SLOW flow from input through output.
 */
function historyPositionKey(symbol: string, position: HistoryPosition): string {
  return [
    position.account,
    normalizeSymbol(symbol),
    position.opened.vPoint.id,
    position.opened.t,
    position.closed?.t ?? "",
    position.exposure.quantity,
    position.exposure.notionalUsdt,
  ].join("|");
}

/** Lists persisted history symbols for one mode. */
async function listHistorySymbols(mode: SlowTradingMode): Promise<string[]> {
  const entries = await fs
    .readdir(FILES.prod.history(mode), { withFileTypes: true })
    .catch(() => []);

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => normalizeSymbol(path.basename(entry.name, ".json")))
    .filter(Boolean);
}

/**
 * Reads the shared mode history file. Rows carry their own `account` field;
 * callers filter by account when they need one account's slice.
 */
async function readSharedHistoryFile(
  mode: SlowTradingMode,
  symbol: string,
): Promise<Position[]> {
  const filePath = FILES.prod.historyFile(mode, normalizeSymbol(symbol));
  if (!(await fs.pathExists(filePath))) {
    return [];
  }

  const raw = await fs.readJSON(filePath);
  return Array.isArray(raw) ? raw : [];
}

/**
 * Reads one account's rows from the shared mode history file.
 */
export async function readHistoryFile(
  account: string,
  mode: SlowTradingMode,
  symbol: string,
): Promise<Position[]> {
  if (!ACCOUNT_SLUG_PATTERN.test(account)) {
    return [];
  }

  const positions = await readSharedHistoryFile(mode, symbol);
  return positions.filter((position) => position.account === account);
}

/** Reads closed history rows belonging to any of the requested accounts. */
export async function readHistoryForAccounts(params: {
  accountSlugs: readonly string[];
  mode: SlowTradingMode;
  symbol?: string;
}): Promise<SlowTradingHistoryPosition[]> {
  const accountSlugs = new Set(
    params.accountSlugs.filter((slug) => ACCOUNT_SLUG_PATTERN.test(slug)),
  );
  if (accountSlugs.size === 0) return [];

  const requestedSymbol = normalizeSymbol(params.symbol ?? "");
  const symbols = requestedSymbol
    ? [requestedSymbol]
    : await listHistorySymbols(params.mode);
  const history: SlowTradingHistoryPosition[] = [];

  for (const symbol of symbols) {
    const positions = await readSharedHistoryFile(params.mode, symbol);

    history.push(
      ...positions
        .filter(
          (position) =>
            Boolean(position.closed) &&
            accountSlugs.has(String(position.account ?? "")),
        )
        .map((position) => ({
          ...clone(position),
          mode: params.mode,
          symbol,
        })),
    );
  }

  return history.sort((left, right) => left.opened.t - right.opened.t);
}

/** Reads closed positions whose closing time falls within a half-open range. */
export async function readHistoryRange(params: {
  /** Restricts the range to one immutable account slug when provided. */
  account?: string;
  endTime: number;
  mode: SlowTradingMode;
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
 * Filters persisted history rows for memory hydration.
 */
function filterHistoryPositions(
  positions: Position[],
  options: HydrateSlowTradingHistoryOptions,
): Position[] {
  const fromTime =
    typeof options.fromTime === "number" && Number.isFinite(options.fromTime)
      ? options.fromTime
      : null;

  return positions.filter((position) => {
    // BOTH:MULTI_ACCOUNT_HISTORY_OWNER
    if (options.account && position.account !== options.account) return false;
    return fromTime == null || (position.closed?.t ?? 0) >= fromTime;
  });
}

/**
 * Replaces one account's rows inside the shared mode history file while
 * preserving every other account's rows.
 */
export async function writeHistoryFile(
  account: string,
  mode: SlowTradingMode,
  symbol: string,
  positions: Position[],
) {
  const normalizedSymbol = normalizeSymbol(symbol);
  await slowTradingJsonFile.update.atomic<Position[]>(
    FILES.prod.historyFile(mode, normalizedSymbol),
    (raw) => {
      const current = Array.isArray(raw) ? (raw as Position[]) : [];
      const others = current.filter(
        (position) => position.account !== account,
      );
      return [...others, ...positions].sort(
        (a, b) => (a.opened.t ?? 0) - (b.opened.t ?? 0),
      );
    },
  );
}

/**
 * Appends closed positions to the shared mode history file. Rows keep their
 * own `account` field; rows missing it fall back to the account whose mode
 * state is being saved.
 */
async function appendHistoryPositions(params: {
  fallbackAccount?: string;
  mode: SlowTradingMode;
  symbol: string;
  positions: Position[];
}): Promise<number> {
  const symbol = normalizeSymbol(params.symbol);
  const incoming = params.positions
    .filter((position) => position.closed?.t)
    .map((position) => {
      const account =
        typeof position.account === "string" &&
        ACCOUNT_SLUG_PATTERN.test(position.account)
          ? position.account
          : params.fallbackAccount;
      return account ? { ...clone(position), account } : null;
    })
    .filter((position): position is Position => Boolean(position));
  if (incoming.length === 0) {
    return 0;
  }

  let added = 0;
  await slowTradingJsonFile.update.atomic<Position[]>(
    FILES.prod.historyFile(params.mode, symbol),
    (raw) => {
      const existing = Array.isArray(raw) ? (raw as Position[]) : [];
      const seen = new Set(
        existing.map((position) => historyPositionKey(symbol, position)),
      );
      const next = [...existing];

      for (const position of incoming) {
        const key = historyPositionKey(symbol, position);
        if (seen.has(key)) {
          continue;
        }

        seen.add(key);
        next.push(position);
        added += 1;
      }

      return next.sort((a, b) => (a.opened.t ?? 0) - (b.opened.t ?? 0));
    },
  );

  return added;
}

/**
 * Persists closed positions to history files from memory into SLOW storage.
 * Rows are appended to the shared `history/<mode>/<SYMBOL>.json` file; rows
 * missing `account` fall back to the account whose mode state is being saved.
 */
export async function persistClosedPositionsToHistoryFiles(
  mode: SlowTradingMode,
  modeState: SlowTradingModeState,
  fallbackAccount?: string,
): Promise<number> {
  let archived = 0;

  for (const tradeSetting of modeState.tradeSettings) {
    const positionsSell = tradeSetting.model_memory.positionsSell ?? [];
    archived += await appendHistoryPositions({
      fallbackAccount,
      mode,
      symbol: normalizeSymbol(tradeSetting.symbol),
      positions: positionsSell,
    });
    tradeSetting.model_memory.positionsSell = [];
  }

  return archived;
}

/**
 * Hydrates mode history from files from SLOW history files into memory.
 */
async function hydrateModeHistoryFromFiles(
  mode: SlowTradingMode,
  modeState: SlowTradingModeState,
  options: HydrateSlowTradingHistoryOptions = {},
) {
  const account = options.account;
  if (!account || !ACCOUNT_SLUG_PATTERN.test(account)) {
    return;
  }

  // PROD:HISTORY_CONFIG_INDEPENDENT
  // Report loads discover persisted symbols independently from config symbols.
  if (!options.symbols) {
    const existingSymbols = new Set(
      modeState.tradeSettings.map((item) => normalizeSymbol(item.symbol)),
    );
    const persistedSymbols = (await listHistorySymbols(mode)).sort((a, b) =>
      a.localeCompare(b),
    );

    for (const symbol of persistedSymbols) {
      if (existingSymbols.has(symbol)) {
        continue;
      }

      existingSymbols.add(symbol);
      modeState.tradeSettings.push({
        symbol,
        model_memory: {
          positions: [],
        },
      });
    }
  }

  const allowedSymbols = options.symbols
    ? new Set(options.symbols.map((symbol) => normalizeSymbol(symbol)))
    : null;

  for (const tradeSetting of modeState.tradeSettings) {
    const symbol = normalizeSymbol(tradeSetting.symbol);
    if (allowedSymbols && !allowedSymbols.has(symbol)) {
      continue;
    }

    tradeSetting.model_memory.positionsSell = filterHistoryPositions(
      await readSharedHistoryFile(mode, symbol),
      options,
    );
  }
}

/**
 * Hydrates slow trading history from files from SLOW history files into memory.
 */
export async function hydrateSlowTradingHistoryFromFiles(
  storage: SlowTradingStorageData,
  options: HydrateSlowTradingHistoryOptions = {},
) {
  const scopedOptions = {
    ...options,
    account: options.account ?? storage.account.slug,
  };
  if (!options.mode || options.mode === "live") {
    await hydrateModeHistoryFromFiles("live", storage.modes.live, scopedOptions);
  }

  if (!options.mode || options.mode === "sandbox") {
    await hydrateModeHistoryFromFiles(
      "sandbox",
      storage.modes.sandbox,
      scopedOptions,
    );
  }
}

/** Deletes the shared history directory for one mode. */
export async function clearModeHistoryFiles(mode: SlowTradingMode) {
  await fs.remove(FILES.prod.history(mode));
}
