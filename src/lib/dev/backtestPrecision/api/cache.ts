import { createHash } from "crypto";
import fs from "fs-extra";
import path from "path";
import { jsonFile } from "@/lib/system/storage";
import sanitize from "@/lib/system/storage/sanitize";
import type { ExchangeType } from "@/lib/system/types";
import type { BacktestPrecisionParams } from "./precision-api-types";
import type { BacktestPrecisionResult } from "../backtest/backtest-precision-types";

const CACHE_VERSION = 3;

// Local-only cache — `storage/persistent` syncs between instances, so
// results live under the gitignored `storage/cache/` next to `datasets/`.
// Layout: backtest-precision/<hash>/<result key>.json + meta.json.
const RESULTS_DIR = path.resolve("storage/cache/backtest-precision");

const RESULT_FIELDS = [
  "balanceSnapshots",
  "positions",
  "vPointsMap",
] as const satisfies readonly (keyof BacktestPrecisionResult)[];

interface BacktestResultCacheMeta {
  createdAt: number;
  exchangeType: ExchangeType;
  /** Effective request params with credential values masked out. */
  params: Record<string, unknown>;
  v: number;
}

interface BacktestResultCacheIdentity {
  config: unknown;
  endTime?: number;
  range: string;
  startTime?: number;
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
    .join(",")}}`;
}

function cacheDir(cacheKey: string): string {
  return path.join(RESULTS_DIR, cacheKey);
}

/** Absolute path of the directory holding one cache entry's artifacts. */
function dirFor(cacheKey: string): string {
  return cacheDir(cacheKey);
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

/** Rebuilds the saved result from its per-key files, or null on miss/corruption. */
async function read(
  cacheKey: string,
): Promise<BacktestPrecisionResult | null> {
  const dir = cacheDir(cacheKey);
  try {
    const meta = (await fs.readJson(
      path.join(dir, "meta.json"),
    )) as BacktestResultCacheMeta;
    if (meta?.v !== CACHE_VERSION || !meta.exchangeType) {
      return null;
    }

    const result = {
      exchangeType: meta.exchangeType,
    } as Record<keyof BacktestPrecisionResult, unknown>;
    for (const field of RESULT_FIELDS) {
      result[field] = await fs.readJson(path.join(dir, `${field}.json`));
    }
    if (!Array.isArray(result.positions)) {
      return null;
    }
    return result as unknown as BacktestPrecisionResult;
  } catch {
    return null;
  }
}

/**
 * Persists one result key per file so each artifact is inspectable alone.
 * `meta.json` records the effective request params — the full inference input
 * — with credential values masked, so a cached run can be reproduced and
 * debugged without re-deriving what produced it.
 */
async function write(params: {
  key: string;
  params: BacktestPrecisionParams;
  result: BacktestPrecisionResult;
}): Promise<void> {
  const dir = cacheDir(params.key);
  for (const field of RESULT_FIELDS) {
    await jsonFile.write.atomic(
      path.join(dir, `${field}.json`),
      params.result[field],
    );
  }

  // `initialState` is a full runtime snapshot — far too large for meta, and
  // precision-checker replays never reach this writer anyway.
  const { initialState: _initialState, ...requestParams } = params.params;
  const meta: BacktestResultCacheMeta = {
    createdAt: Date.now(),
    exchangeType: params.result.exchangeType,
    params: sanitize.maskSecrets(requestParams) as Record<string, unknown>,
    v: CACHE_VERSION,
  };
  await fs.outputJson(path.join(dir, "meta.json"), meta, { spaces: 2 });
}

const backtestResultCache = {
  get dir() {
    return RESULTS_DIR;
  },
  dirFor,
  key,
  read,
  write,
} as const;

export default backtestResultCache;
