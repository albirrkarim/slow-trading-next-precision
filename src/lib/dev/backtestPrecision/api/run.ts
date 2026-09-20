import { timeMsToReadable } from "@/lib/datasets/utils";
import { isDevBacktestEnabled } from "@/lib/env/devBacktest";
import type { SlowTradingSettingsConfig } from "@/lib/slowTrading";
import { tradeLog } from "@/lib/trading";
import type { NextApiRequest, NextApiResponse } from "next";
import type { BacktestPrecisionParams } from "./precision-api-types";
import { precisionBacktest } from "../backtest";

export default async function backtestPrecisionHandler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (!isDevBacktestEnabled()) {
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

  const settingsConfig = config as unknown as SlowTradingSettingsConfig;

  let { range, startTime, endTime } = params;

  if (startTime && endTime && range == "custom") {
    range = `${timeMsToReadable(startTime)}_to_${timeMsToReadable(endTime)}`;
  } else {
    startTime = undefined;
    endTime = undefined;
  }

  const tradeLogSession = tradeLog.startSession({
    categories: ["debug"],
    verbose: Boolean(verbose),
  });

  try {
    const enabledAccounts = settingsConfig.accounts.filter(
      (account) => account.enabled,
    );
    if (enabledAccounts.length === 0) {
      throw new Error("Enable at least one SLOW account before backtesting.");
    }

    await precisionBacktest({
      ...params,
      endTime,
      range,
      startTime,
      upToDateDecisionBacktest,
      upToDateKlines,
      verbose: Boolean(verbose),
    });

    res.json({
      data: true,
    });
  } finally {
    tradeLog.endSession(tradeLogSession);
  }
}
