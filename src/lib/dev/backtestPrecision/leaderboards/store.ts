import { createHash } from "crypto";
import fs from "fs-extra";
import path from "path";
import { jsonFile } from "@/lib/system/storage";
import type {
  BacktestLeaderboardEntry,
  BacktestLeaderboardMetrics,
} from "./types";

// Local-only dev records — `storage/` is gitignored, same as the result cache.
// Layout: storage/leaderboards/<hash>.json, one file per saved run.
const DEFAULT_DIR = path.resolve("storage/leaderboards");

function dir(): string {
  return process.env.BACKTEST_LEADERBOARDS_DIR?.trim() || DEFAULT_DIR;
}

/** Serializes with sorted object keys so hashing ignores input field order. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries
    .map(
      ([entryKey, entryValue]) =>
        `${JSON.stringify(entryKey)}:${stableStringify(entryValue)}`,
    )
    .join("")}}`;
}

/** Short deterministic id — same config + cache key overwrites its entry. */
function entryId(input: {
  backtestConfig: unknown;
  cacheKey?: string;
}): string {
  return createHash("sha256")
    .update(
      stableStringify({
        backtestConfig: input.backtestConfig,
        cacheKey: input.cacheKey,
      }),
    )
    .digest("hex")
    .slice(0, 12);
}

function isEntry(value: unknown): value is BacktestLeaderboardEntry {
  const entry = value as BacktestLeaderboardEntry | null;
  return (
    typeof entry === "object" &&
    entry !== null &&
    typeof entry.id === "string" &&
    typeof entry.t === "number" &&
    typeof entry.leaderboard === "object" &&
    entry.leaderboard !== null
  );
}

/** Lists saved entries, newest first; unreadable files are skipped. */
async function list(): Promise<BacktestLeaderboardEntry[]> {
  const directory = dir();
  if (!(await fs.pathExists(directory))) return [];

  const names = (await fs.readdir(directory)).filter((name) =>
    name.endsWith(".json"),
  );
  const entries: BacktestLeaderboardEntry[] = [];
  for (const name of names) {
    try {
      const parsed = await fs.readJson(path.join(directory, name));
      if (isEntry(parsed)) entries.push(parsed);
    } catch {
      // skip malformed files
    }
  }
  return entries.sort((left, right) => right.t - left.t);
}

/** Atomically writes one entry; same id overwrites the previous record. */
async function save(input: {
  backtestConfig: unknown;
  cacheKey?: string;
  label?: string;
  leaderboard: BacktestLeaderboardMetrics;
}): Promise<BacktestLeaderboardEntry> {
  const id = entryId({
    backtestConfig: input.backtestConfig,
    cacheKey: input.cacheKey,
  });
  const entry: BacktestLeaderboardEntry = {
    id,
    t: Date.now(),
    backtestConfig: input.backtestConfig,
    cacheKey: input.cacheKey,
    label: input.label,
    leaderboard: input.leaderboard,
  };
  await jsonFile.write.atomic(path.join(dir(), `${id}.json`), entry);
  return entry;
}

/** Deletes one entry by id; false when it does not exist. */
async function remove(id: string): Promise<boolean> {
  const filePath = path.join(dir(), `${id}.json`);
  if (!(await fs.pathExists(filePath))) return false;
  await fs.remove(filePath);
  return true;
}

const leaderboardsStore = {
  dir,
  list,
  remove,
  save,
} as const;

export default leaderboardsStore;
