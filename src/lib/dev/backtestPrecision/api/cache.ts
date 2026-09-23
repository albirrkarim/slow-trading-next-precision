import { createHash } from "crypto";
import fs from "fs-extra";
import path from "path";
import { jsonFile, storageFiles } from "@/lib/system/storage";
import type { BacktestPrecisionResult } from "../backtest/backtest-precision-types";

const CACHE_VERSION = 1;

interface BacktestResultCacheFile {
  createdAt: number;
  endTime?: number;
  range: string;
  result: BacktestPrecisionResult;
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

function cacheFilePath(cacheKey: string): string {
  return path.join(storageFiles.dev.backtestResults, `${cacheKey}.json`);
}

/**
 * Hashes the effective backtest identity (range/bounds + full config) so the
 * same inputs reuse one saved result. Credentials feed the hash only; they
 * are never persisted in the cache file.
 */
function key(identity: BacktestResultCacheIdentity): string {
  return createHash("sha256")
    .update(stableStringify({ v: CACHE_VERSION, ...identity }))
    .digest("hex");
}

/** Returns the saved result for one identity, or null on miss/corruption. */
async function read(
  cacheKey: string,
): Promise<BacktestPrecisionResult | null> {
  try {
    const cached = (await fs.readJson(
      cacheFilePath(cacheKey),
    )) as BacktestResultCacheFile;
    if (
      cached?.v !== CACHE_VERSION ||
      !cached.result ||
      typeof cached.result !== "object" ||
      !Array.isArray(cached.result.positions)
    ) {
      return null;
    }
    return cached.result;
  } catch {
    return null;
  }
}

/** Persists one run result under its identity hash for later reuse/debugging. */
async function write(params: {
  endTime?: number;
  key: string;
  range: string;
  result: BacktestPrecisionResult;
  startTime?: number;
}): Promise<void> {
  const payload: BacktestResultCacheFile = {
    createdAt: Date.now(),
    endTime: params.endTime,
    range: params.range,
    result: params.result,
    startTime: params.startTime,
    v: CACHE_VERSION,
  };
  await jsonFile.write.atomic(cacheFilePath(params.key), payload);
}

const backtestResultCache = {
  key,
  read,
  write,
} as const;

export default backtestResultCache;
