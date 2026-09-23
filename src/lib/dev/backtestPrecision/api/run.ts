import systemConfig from "@/lib/system/config";
import systemTime from "@/lib/system/time";
import type { NextApiRequest, NextApiResponse } from "next";
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

async function dynamicTradeBacktest(req: NextApiRequest, res: NextApiResponse) {
  // A. Initialize
  const params = (req.method == "GET"
    ? req.query
    : req.body) as unknown as BacktestPrecisionParams;
  const {
    upToDateKlines = false,
    upToDateDecisionBacktest = false,
    config,
    verbose = true,
  } = params;

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

  const result = await precisionBacktest({
    ...params,
    range,
    endTime,
    startTime,
    upToDateDecisionBacktest,
    upToDateKlines,
    verbose: Boolean(verbose),
  });

  res.json(result);
}
