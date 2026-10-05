import { createHash } from "crypto";
import fs from "fs-extra";
import path from "path";
import { jsonFile } from "@/lib/system/storage";
import type {
  BacktestLeaderboardEntry,
  BacktestLeaderboardMetrics,
} from "./types";

// Local-only dev records — `storage/` is gitignored, same as the result cache.
// Layout: storage/leaderboards/results/<hash>.json, one file per saved run;
// profiles.json sits beside the results/ directory.
const DEFAULT_DIR = path.resolve("storage/leaderboards");

function dir(): string {
  return process.env.BACKTEST_LEADERBOARDS_DIR?.trim() || DEFAULT_DIR;
}

function resultsDir(): string {
  return path.join(dir(), "results");
}

/**
 * Moves pre-subdirectory entry files from the leaderboards root into results/.
 * profiles.json stays in the root — it is a different record type.
 */
async function migrateLegacyEntries(): Promise<void> {
  const directory = dir();
  if (!(await fs.pathExists(directory))) return;
  const names = (await fs.readdir(directory)).filter(
    (name) => name.endsWith(".json") && name !== "profiles.json",
  );
  if (names.length === 0) return;
  await fs.ensureDir(resultsDir());
  for (const name of names) {
    await fs.move(
      path.join(/* turbopackIgnore: true */ directory, name),
      path.join(/* turbopackIgnore: true */ resultsDir(), name),
      { overwrite: true },
    );
  }
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

/**
 * Short deterministic id. Identity is the run itself: when a `cacheKey`
 * exists it alone is hashed — config-only knobs (like
 * `upToDateDecisionBacktest`) may differ between saves of the same cached
 * result without minting a duplicate. Saves with no cacheKey fall back to
 * hashing the config.
 */
function entryId(input: {
  backtestConfig: unknown;
  cacheKey?: string;
}): string {
  return createHash("sha256")
    .update(
      stableStringify(
        input.cacheKey
          ? { cacheKey: input.cacheKey }
          : { backtestConfig: input.backtestConfig },
      ),
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
  await migrateLegacyEntries();
  const directory = resultsDir();
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
  let id = entryId({
    backtestConfig: input.backtestConfig,
    cacheKey: input.cacheKey,
  });
  let favorite: boolean | undefined;
  if (input.cacheKey) {
    // Merge earlier saves of this run (hashed under the old
    // config+cacheKey scheme) into one entry — keep the favorited id, else
    // the newest, and drop the rest.
    const sameRun = (await list()).filter(
      (entry) => entry.cacheKey === input.cacheKey,
    );
    const keep = sameRun.find((entry) => entry.favorite) ?? sameRun[0];
    if (keep) {
      id = keep.id;
      favorite = keep.favorite;
    }
    for (const entry of sameRun) {
      if (entry.id !== id) await remove(entry.id);
    }
  }
  const entry: BacktestLeaderboardEntry = {
    id,
    t: Date.now(),
    backtestConfig: input.backtestConfig,
    cacheKey: input.cacheKey,
    label: input.label,
    leaderboard: input.leaderboard,
    ...(favorite ? { favorite } : {}),
  };
  await jsonFile.write.atomic(
    path.join(resultsDir(), `${id}.json`),
    entry,
  );
  return entry;
}

/** Deletes one entry by id; false when it does not exist. */
async function remove(id: string): Promise<boolean> {
  const filePath = path.join(resultsDir(), `${id}.json`);
  if (!(await fs.pathExists(filePath))) return false;
  await fs.remove(filePath);
  return true;
}

/**
 * Toggles the user-marked favorite flag on one entry; null when the entry
 * does not exist or the file is malformed. The key is dropped when unfavorited
 * so files stay compact.
 */
async function setFavorite(
  id: string,
  favorite: boolean,
): Promise<BacktestLeaderboardEntry | null> {
  const filePath = path.join(resultsDir(), `${id}.json`);
  if (!(await fs.pathExists(filePath))) return null;
  try {
    const entry = await fs.readJson(filePath);
    if (!isEntry(entry)) return null;
    if (favorite) entry.favorite = true;
    else delete entry.favorite;
    await jsonFile.write.atomic(filePath, entry);
    return entry;
  } catch {
    return null;
  }
}

const leaderboardsStore = {
  dir,
  list,
  remove,
  resultsDir,
  save,
  setFavorite,
} as const;

export default leaderboardsStore;
