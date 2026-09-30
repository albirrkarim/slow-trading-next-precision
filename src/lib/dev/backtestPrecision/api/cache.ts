import { createHash, randomUUID } from "crypto";
import fs from "fs-extra";
import path from "path";
import sanitize from "@/lib/system/storage/sanitize";
import type { ExchangeType, VolatilityPoint } from "@/lib/system/types";
import type {
  BacktestBalanceSnapshot,
  BacktestChunkedResult,
  BacktestPrecisionResult,
  BacktestRunCounts,
  BacktestRunSummary,
} from "../backtest/backtest-precision-types";
import backtestArtifacts from "../backtest/artifacts";

/**
 * Cache key version — bumped whenever simulated results must recompute
 * rather than reuse: v5 adds black-swan protection to normal backtests;
 * v6 calibrates its defaults and stamps the distinct BLACK_SWAN_EXIT close
 * reason.
 * CHUNKED_LAYOUT is the on-disk format: v4 streams artifacts into
 * fixed-size part files (positions/, vpoints/<symbol>/, snapshots/<slug>/)
 * plus meta.json; v3 used monolithic field files. `read`/`readField` still
 * understand v3+ for saved cachePaths.
 */
const CACHE_VERSION = 6;
const CHUNKED_LAYOUT = 4;

// Local-only cache — `storage/persistent` syncs between instances, so
// results live under the gitignored `storage/cache/` next to `datasets/`.
const RESULTS_DIR = path.resolve("storage/cache/backtest-precision");

const LEGACY_FIELDS = [
  "balanceSnapshots",
  "positions",
  "vPointsMap",
] as const satisfies readonly (keyof BacktestPrecisionResult)[];

interface BacktestResultCacheMeta {
  createdAt: number;
  /** Effective simulated window after symbol-availability intersection. */
  dataset?: { endTime: number; startTime: number };
  exchangeType?: ExchangeType;
  counts?: BacktestRunCounts;
  summary?: BacktestRunSummary;
  parts?: unknown;
  /** Effective request params with credential values masked out. */
  params?: Record<string, unknown>;
  v: number;
}

interface BacktestResultCacheIdentity {
  config: unknown;
  endTime?: number;
  range: string;
  startTime?: number;
}

type BacktestDetailField = "positions" | "vpoints" | "snapshots";

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
    .join(",")}}`;
}

function cacheDir(cacheKey: string): string {
  return path.join(/* turbopackIgnore: true */ RESULTS_DIR, cacheKey);
}

/** Absolute path of the directory holding one cache entry's artifacts. */
function dirFor(cacheKey: string): string {
  return cacheDir(cacheKey);
}

/** Gives each run a private artifact directory until its metadata is complete. */
function stagingDirFor(cacheKey: string): string {
  return path.join(RESULTS_DIR, ".staging", `${cacheKey}-${randomUUID()}`);
}

interface BacktestFailedRecord {
  /** Failure message from the rejected run. */
  error: string;
  t: number;
}

/**
 * `.failed/<cacheKey>.json` — one record per failed run, alongside `.staging`.
 * Without it a crashed run is indistinguishable from never-started: meta.json
 * is only written on success and the staging dir is removed on error.
 */
function failedPathFor(cacheKey: string): string {
  return path.join(RESULTS_DIR, ".failed", `${cacheKey}.json`);
}

/**
 * Records a failed run. Best-effort — bookkeeping must never mask the
 * original run error, so write failures are swallowed.
 */
async function markFailed(cacheKey: string, error: unknown): Promise<void> {
  try {
    const record: BacktestFailedRecord = {
      error: error instanceof Error ? error.message : String(error),
      t: Date.now(),
    };
    await fs.outputJson(failedPathFor(cacheKey), record);
  } catch {
    // ignore — the run error is rethrown by the caller
  }
}

/** Reads the failure record for one cache key; null when none exists. */
async function readFailed(
  cacheKey: string,
): Promise<BacktestFailedRecord | null> {
  try {
    const record = (await fs.readJson(
      failedPathFor(cacheKey),
    )) as BacktestFailedRecord;
    if (typeof record?.error !== "string" || typeof record?.t !== "number") {
      return null;
    }
    return record;
  } catch {
    return null;
  }
}

/** Drops the failure record — called when a fresh attempt starts. */
async function clearFailed(cacheKey: string): Promise<void> {
  await fs.remove(failedPathFor(cacheKey));
}

/** Replaces a finished cache entry without exposing partially written parts. */
async function publish(cacheKey: string, stagingDir: string): Promise<void> {
  await fs.move(stagingDir, cacheDir(cacheKey), { overwrite: true });
}

/**
 * Hashes the effective backtest identity (range/bounds + full config) so the
 * same inputs reuse one saved result. Credentials feed the hash only; they
 * are never persisted in the cache files.
 */
function key(identity: BacktestResultCacheIdentity): string {
  return createHash("sha256")
    .update(stableStringify({ v: CACHE_VERSION, ...identity }))
    .digest("hex");
}

async function readMetaFile(dir: string): Promise<BacktestResultCacheMeta | null> {
  try {
    return (await fs.readJson(path.join(dir, "meta.json"))) as BacktestResultCacheMeta;
  } catch {
    return null;
  }
}

/**
 * Reads only meta.json — never the artifact parts — so a cache hit stays
 * cheap regardless of result size. Returns null for missing entries and for
 * older layout versions, which recompute instead.
 */
async function readMeta(cacheKey: string): Promise<{
  counts: BacktestRunCounts;
  createdAt?: number;
  dataset?: { endTime: number; startTime: number };
  exchangeType: ExchangeType;
  summary: BacktestRunSummary;
} | null> {
  const meta = await readMetaFile(cacheDir(cacheKey));
  if (meta?.v !== CHUNKED_LAYOUT) return null;
  if (!meta.exchangeType || !meta.counts || !meta.summary) return null;
  return {
    counts: meta.counts,
    createdAt: meta.createdAt,
    dataset: meta.dataset,
    exchangeType: meta.exchangeType,
    summary: meta.summary,
  };
}

/** Masked request params recorded at finalize — drives run listings. */
async function readParams(
  cacheKey: string,
): Promise<Record<string, unknown> | null> {
  const meta = await readMetaFile(cacheDir(cacheKey));
  return meta?.params ?? null;
}

/**
 * Locates a live staging directory for one cache key — present only while a
 * run is mid-flight. Returns the newest match plus its mtime so callers can
 * flag a stale (interrupted) staging dir whose writer already died.
 */
async function stagingInfo(
  cacheKey: string,
): Promise<{ dir: string; modifiedAt: number } | null> {
  const stagingRoot = path.join(RESULTS_DIR, ".staging");
  if (!(await fs.pathExists(stagingRoot))) return null;
  const matches = (await fs.readdir(stagingRoot)).filter((name) =>
    name.startsWith(`${cacheKey}-`),
  );
  let newest: { dir: string; modifiedAt: number } | null = null;
  for (const name of matches) {
    const dir = path.join(stagingRoot, name);
    const modifiedAt = (await fs.stat(dir)).mtimeMs;
    if (!newest || modifiedAt > newest.modifiedAt) {
      newest = { dir, modifiedAt };
    }
  }
  return newest;
}

/** Lists finished cache entries (meta.json only), newest first. */
async function listMetas(): Promise<
  Array<{ cacheKey: string } & NonNullable<Awaited<ReturnType<typeof readMeta>>> & {
      params?: Record<string, unknown>;
    }>
> {
  if (!(await fs.pathExists(RESULTS_DIR))) return [];
  const entries: Array<{
    cacheKey: string;
    createdAt?: number;
    counts: BacktestRunCounts;
    dataset?: { endTime: number; startTime: number };
    exchangeType: ExchangeType;
    params?: Record<string, unknown>;
    summary: BacktestRunSummary;
  }> = [];
  for (const name of await fs.readdir(RESULTS_DIR)) {
    if (!/^[0-9a-f]{64}$/.test(name)) continue;
    const meta = await readMetaFile(
      path.join(/* turbopackIgnore: true */ RESULTS_DIR, name),
    );
    if (
      meta?.v !== CHUNKED_LAYOUT ||
      !meta.exchangeType ||
      !meta.counts ||
      !meta.summary
    ) {
      continue;
    }
    entries.push({
      cacheKey: name,
      counts: meta.counts,
      createdAt: meta.createdAt,
      dataset: meta.dataset,
      exchangeType: meta.exchangeType,
      params: meta.params,
      summary: meta.summary,
    });
  }
  return entries.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

/**
 * Materializes the full result — chunked dirs concatenate part files,
 * legacy dirs read the monolithic field files. Intended for one-off server
 * consumers (leaderboard metrics), not the per-request UI path.
 */
async function read(
  cacheKey: string,
): Promise<BacktestPrecisionResult | null> {
  const dir = cacheDir(cacheKey);
  const meta = await readMetaFile(dir);
  // An interrupted run may have part files but no valid metadata.
  if (!meta) return null;
  const chunked = meta.v === CHUNKED_LAYOUT;

  try {
    if (chunked) {
      const [positions, vPointsMap, balanceSnapshots] = await Promise.all([
        backtestArtifacts.read.positions(dir),
        backtestArtifacts.read.vpoints(dir),
        backtestArtifacts.read.snapshots(dir),
      ]);
      return {
        balanceSnapshots:
          balanceSnapshots as Record<string, BacktestBalanceSnapshot[]>,
        exchangeType: meta?.exchangeType ?? "binance",
        positions,
        vPointsMap: vPointsMap as Record<string, VolatilityPoint[]>,
      };
    }

    if (meta?.v !== 3 || !meta.exchangeType) return null;
    const result = {
      exchangeType: meta.exchangeType,
    } as Record<keyof BacktestPrecisionResult, unknown>;
    for (const field of LEGACY_FIELDS) {
      result[field] = await fs.readJson(
        path.join(/* turbopackIgnore: true */ dir, `${field}.json`),
      );
    }
    if (!Array.isArray(result.positions)) return null;
    return result as unknown as BacktestPrecisionResult;
  } catch {
    return null;
  }
}

/**
 * Writes meta.json after a run already streamed its artifacts into the
 * directory — no result field is re-serialized here. Records the effective
 * request params with credential values masked so a cached run can be
 * reproduced and debugged.
 */
async function finalize(
  cacheKey: string,
  result: BacktestChunkedResult,
  params: Record<string, unknown>,
  dir = cacheDir(cacheKey),
): Promise<void> {
  // `initialState` is a full runtime snapshot — far too large for meta, and
  // precision-checker replays never reach this writer anyway.
  const { initialState: _initialState, ...requestParams } = params;
  const meta: BacktestResultCacheMeta = {
    counts: result.counts,
    createdAt: Date.now(),
    dataset: result.dataset,
    exchangeType: result.exchangeType,
    params: sanitize.stripSecrets(requestParams) as Record<string, unknown>,
    parts: result.parts,
    summary: result.summary,
    v: CHUNKED_LAYOUT,
  };
  await fs.outputJson(path.join(dir, "meta.json"), meta, {
    spaces: 2,
  });
}

/**
 * Serves one artifact field for the lazy detail endpoint. `name` scopes
 * vpoints to a symbol and snapshots to an account slug. Legacy (v3) dirs
 * answer from their monolithic field files.
 */
async function readField(
  cacheKey: string,
  field: BacktestDetailField,
  name?: string,
): Promise<unknown> {
  const dir = cacheDir(cacheKey);
  if (!(await fs.pathExists(dir))) return null;
  const meta = await readMetaFile(dir);
  if (!meta) return null;
  const chunked = meta.v === CHUNKED_LAYOUT;

  try {
    if (chunked) {
      if (field === "positions") return backtestArtifacts.read.positions(dir);
      if (field === "vpoints") return backtestArtifacts.read.vpoints(dir, name);
      return backtestArtifacts.read.snapshots(dir, name);
    }

    const legacyFile = (legacyField: keyof BacktestPrecisionResult) =>
      path.join(/* turbopackIgnore: true */ dir, `${legacyField}.json`);
    if (field === "positions") {
      const file = legacyFile("positions");
      return (await fs.pathExists(file)) ? fs.readJson(file) : null;
    }
    const mapFile =
      field === "vpoints"
        ? legacyFile("vPointsMap")
        : legacyFile("balanceSnapshots");
    if (!(await fs.pathExists(mapFile))) return null;
    const map = (await fs.readJson(mapFile)) as Record<string, unknown>;
    return name ? (map[name] ?? []) : map;
  } catch {
    return null;
  }
}

const backtestResultCache = {
  get dir() {
    return RESULTS_DIR;
  },
  clearFailed,
  dirFor,
  finalize,
  key,
  listMetas,
  markFailed,
  read,
  readFailed,
  readField,
  readMeta,
  readParams,
  publish,
  stagingDirFor,
  stagingInfo,
} as const;

export default backtestResultCache;
