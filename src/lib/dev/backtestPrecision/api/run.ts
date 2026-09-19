import type { DynamicTradeBacktestInput } from "@/components/api/dynamic";
import { timeMsToReadable } from "@/lib/datasets/utils";
import { isDevBacktestEnabled } from "@/lib/env/devBacktest";
import type { SlowTradingSettingsConfig } from "@/lib/slowTrading";
import { tradeLog } from "@/lib/trading";
import type { NextApiRequest, NextApiResponse } from "next";

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
  const params = req.method == "GET" ? req.query : req.body;
  const {
    symbols = ["BTC"],
    upToDateKlines = false,
    upToDateDecisionBacktest = false,
    config,

    mode = "kline",

    decisionEngineVersion = "decision.v7",

    verbose = true,
    multiAccount = false,
  } = params as DynamicTradeBacktestInput;

  const settingsConfig = config as unknown as SlowTradingSettingsConfig;

  let { range, startTime, endTime } = params as DynamicTradeBacktestInput;

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

  // We need BTC
  if (!symbols.includes("BTC")) {
    symbols.push("BTC");
  }

  symbols.sort((a, b) => a.localeCompare(b));

  // B. Dynamic backtest
  const enabledAccounts = multiAccount
    ? settingsConfig.accounts.filter((account) => account.enabled)
    : [];
  if (multiAccount && enabledAccounts.length === 0) {
    throw new Error("Enable at least one SLOW account before backtesting.");
  }
  // BTEST:BACKTEST_ACCOUNT_INPUT_LOG
  console.log("[backtest-precision] received account inputs", {
    decisionEngineVersion,
    mode,
    range,
    symbols,
    totalStartingBalanceUSDT: enabledAccounts.reduce(
      (total, account) => total + account.sandbox.initialBalanceUSDT,
      0,
    ),
    accounts: enabledAccounts.map((account) => ({
      enabled: account.enabled,
      name: account.name,
      sandboxEnabled: account.sandbox.enabled,
      slug: account.slug,
      startingBalanceUSDT: account.sandbox.initialBalanceUSDT,
      trading: account.trading,
    })),
  });
}
