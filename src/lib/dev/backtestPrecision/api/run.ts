import fs from "fs-extra";

import systemConfig from "@/lib/system/config";
import systemTime from "@/lib/system/time";
import type { NextApiRequest, NextApiResponse } from "next";
import backtestResultCache from "./cache";
import backtestRunner from "./runner";
import type {
  BacktestPrecisionParams,
  BacktestPrecisionResponse,
} from "./precision-api-types";
import { precisionBacktest } from "../backtest";
import featureGateDataset from "../feature-gate-dataset";

export default async function backtestPrecisionHandler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (!systemConfig.devBacktest.isEnabled()) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  if (req.method === "POST") {
    await dynamicTradeBacktest(req, res);
  } else {
    res.setHeader("Allow", ["GET", "POST", "DELETE"]);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}

function pickBoolean(value: unknown): boolean {
  return value === true || value === "true" || value === "1";
}

async function dynamicTradeBacktest(req: NextApiRequest, res: NextApiResponse) {
  // A. Initialize
  const params = (req.method == "GET"
    ? req.query
    : req.body) as unknown as BacktestPrecisionParams;
  const { config } = params;
  const upToDateKlines = pickBoolean(params.upToDateKlines);
  const upToDateDecisionBacktest = pickBoolean(
    params.upToDateDecisionBacktest,
  );
  const produceDataset = pickBoolean(params.produceDataset);
  const verbose =
    params.verbose === undefined ? true : pickBoolean(params.verbose);

  let { range, startTime, endTime } = params;

  if (startTime && endTime && range == "custom") {
    range = `${systemTime.formatReadable(startTime)}_to_${systemTime.formatReadable(endTime)}`;
  } else {
    startTime = undefined;
    endTime = undefined;
  }

  const enabledAccounts = config.accounts.filter(
    (account) => account.enabled,
  );
  if (enabledAccounts.length === 0) {
    throw new Error("Enable at least one PRECISION account before backtesting.");
  }

  // B. Reuse the saved result unless a freshness flag forces a recompute.
  //    `upToDateKlines` also refreshes the candle dataset inside the run.
  //    The response stays slim — artifact fields are served lazily through
  //    the detail endpoint — so a cache hit only needs meta.json.
  const useCache =
    (params as { mode?: string }).mode !== "precision-checker";
  const cacheKey = backtestResultCache.key({
    config,
    endTime,
    range,
    startTime,
  });
  const cachePath = backtestResultCache.dirFor(cacheKey);
  if (useCache && !upToDateDecisionBacktest && !upToDateKlines) {
    const cached = await backtestResultCache.readMeta(cacheKey);
    // A dataset request can only reuse a cached run that produced one —
    // otherwise the same simulation must rerun with the collector wired in.
    const datasetReady =
      !produceDataset ||
      (await fs.pathExists(featureGateDataset.datasetDir(cachePath)));
    if (cached && datasetReady) {
      const body: BacktestPrecisionResponse = {
        ...cached,
        cached: true,
        cacheKey,
        cachePath,
      };
      res.json(body);
      return;
    }
  }

  // Non-cached callers (precision-checker replays) keep the historical
  // full-result response and never touch the shared cache — their
  // `initialState` is not part of the cache key.
  if (!useCache) {
    const full = await precisionBacktest({
      ...params,
      range,
      endTime,
      startTime,
      upToDateKlines,
      upToDateDecisionBacktest,
      produceDataset,
      verbose,
    });
    res.json({ ...full, cacheKey, cachePath });
    return;
  }

  const run = backtestRunner.start({
    ...params,
    range,
    endTime,
    startTime,
    upToDateKlines,
    upToDateDecisionBacktest,
    produceDataset,
    verbose,
  });
  const result = await run.result;

  // meta.json's createdAt identifies this artifact generation — lazy detail
  // loads key on it so a same-key recompute invalidates resolved entries.
  const meta = await backtestResultCache.readMeta(cacheKey);

  const body: BacktestPrecisionResponse = {
    blackSwanTimeline: result.blackSwanTimeline,
    counts: result.counts,
    dataset: result.dataset,
    exchangeType: result.exchangeType,
    summary: result.summary,
    cached: false,
    cacheKey,
    cachePath,
    createdAt: meta?.createdAt,
  };
  res.json(body);
}
