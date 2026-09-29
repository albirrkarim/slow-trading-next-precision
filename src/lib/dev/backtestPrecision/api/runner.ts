import fs from "fs-extra";

import backtestResultCache from "./cache";
import backtestWorker from "./worker-client";
import type { BacktestWorkerRequest } from "./worker";
import type { BacktestPrecisionParams } from "./precision-api-types";
import type { BacktestChunkedResult } from "../backtest/backtest-precision-types";
import { precisionBacktest } from "../backtest";

export interface BacktestRunHandle {
  /** True when an identical run was already in flight and was reused. */
  alreadyRunning: boolean;
  cacheKey: string;
  cachePath: string;
  /** Resolves when the run's artifacts are finalized and published. */
  result: Promise<BacktestChunkedResult>;
}

/**
 * In-flight runs by cacheKey. The API handler and the MCP tool share this
 * process, so identical concurrent requests join the same run instead of
 * racing two identical simulations.
 */
const activeRuns = new Map<string, Promise<BacktestChunkedResult>>();

async function execute(
  cacheKey: string,
  params: BacktestPrecisionParams,
): Promise<BacktestChunkedResult> {
  const stagingDir = backtestResultCache.stagingDirFor(cacheKey);
  // A fresh attempt supersedes any previous failure record for this key.
  await backtestResultCache.clearFailed(cacheKey);
  const runParams: BacktestWorkerRequest = {
    ...params,
    artifacts: { dir: stagingDir },
  };
  try {
    const result =
      process.env.NODE_ENV === "development"
        ? await backtestWorker.run(runParams)
        : await precisionBacktest(runParams);
    await backtestResultCache.finalize(
      cacheKey,
      result,
      { ...params } as Record<string, unknown>,
      stagingDir,
    );
    await backtestResultCache.publish(cacheKey, stagingDir);
    return result;
  } catch (error) {
    await backtestResultCache.markFailed(cacheKey, error);
    await fs.remove(stagingDir);
    throw error;
  } finally {
    activeRuns.delete(cacheKey);
  }
}

/**
 * Starts one backtest run and returns immediately — the caller decides
 * whether to await `result` (the REST endpoint) or poll status later (MCP).
 * An identical in-flight run is reused via `activeRuns`.
 */
function start(params: BacktestPrecisionParams): BacktestRunHandle {
  const cacheKey = backtestResultCache.key({
    config: params.config,
    endTime: params.endTime,
    range: params.range,
    startTime: params.startTime,
  });
  const cachePath = backtestResultCache.dirFor(cacheKey);

  const existing = activeRuns.get(cacheKey);
  if (existing) {
    return { alreadyRunning: true, cacheKey, cachePath, result: existing };
  }

  const result = execute(cacheKey, params);
  activeRuns.set(cacheKey, result);
  return { alreadyRunning: false, cacheKey, cachePath, result };
}

const backtestRunner = { start } as const;

export default backtestRunner;
