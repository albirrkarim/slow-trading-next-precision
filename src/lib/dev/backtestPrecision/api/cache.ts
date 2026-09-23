import { createHash } from "crypto";
import fs from "fs-extra";
import path from "path";
import { jsonFile } from "@/lib/system/storage";
import type { ExchangeType } from "@/lib/system/types";
import type { BacktestPrecisionResult } from "../backtest/backtest-precision-types";

const CACHE_VERSION = 2;

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
  endTime?: number;
  exchangeType: ExchangeType;
  range: string;
  startTime?: number;
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

/** Persists one result key per file so each artifact is inspectable alone. */
async function write(params: {
  endTime?: number;
  key: string;
  range: string;
  result: BacktestPrecisionResult;
  startTime?: number;
}): Promise<void> {
  const dir = cacheDir(params.key);
  for (const field of RESULT_FIELDS) {
    await jsonFile.write.atomic(
      path.join(dir, `${field}.json`),
      params.result[field],
    );
  }

  const meta: BacktestResultCacheMeta = {
    createdAt: Date.now(),
    endTime: params.endTime,
    exchangeType: params.result.exchangeType,
    range: params.range,
    startTime: params.startTime,
    v: CACHE_VERSION,
  };
  await jsonFile.write.atomic(path.join(dir, "meta.json"), meta);
}

const backtestResultCache = {
  get dir() {
    return RESULTS_DIR;
  },
  key,
  read,
  write,
} as const;

export default backtestResultCache;
