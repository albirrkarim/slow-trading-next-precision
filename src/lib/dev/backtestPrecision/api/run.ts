import systemConfig from "@/lib/system/config";
import systemTime from "@/lib/system/time";
import type { NextApiRequest, NextApiResponse } from "next";
import backtestResultCache from "./cache";
import type { BacktestPrecisionParams } from "./precision-api-types";
import { precisionBacktest } from "../backtest";

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
    throw new Error("Enable at least one SLOW account before backtesting.");
  }

  // B. Reuse the saved result unless a freshness flag forces a recompute.
  //    `upToDateKlines` also refreshes the candle dataset inside the run.
  const useCache =
    (params as { mode?: string }).mode !== "precision-checker";
  const cacheKey = backtestResultCache.key({
    config,
    endTime,
    range,
    startTime,
  });
  if (useCache && !upToDateDecisionBacktest && !upToDateKlines) {
    const cached = await backtestResultCache.read(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }
  }

  const result = await precisionBacktest({
    ...params,
    range,
    endTime,
    startTime,
    upToDateKlines,
    upToDateDecisionBacktest,
    verbose,
  });

  if (useCache) {
    try {
      await backtestResultCache.write({
        endTime,
        key: cacheKey,
        range,
        result,
        startTime,
      });
    } catch (error) {
      console.error("[backtest-precision] Failed to persist result", error);
    }
  }

  res.json(result);
}
