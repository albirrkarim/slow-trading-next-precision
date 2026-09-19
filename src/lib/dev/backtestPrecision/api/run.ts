import type { DynamicTradeBacktestInput } from "@/components/api/dynamic";
import { timeMsToReadable } from "@/lib/datasets/utils";
import { isDevBacktestEnabled } from "@/lib/env/devBacktest";
import type { SlowTradingSettingsConfig } from "@/lib/slowTrading";
import { tradeLog } from "@/lib/trading";
import type { NextApiRequest, NextApiResponse } from "next";
import { BacktestPrecisionParams } from "./precision-api-types";

import { fetchKlinesFunction } from "@/lib/datasets";
import { RuntimeEngine } from "@/lib/precision";
import {
  RuntimeEngineAdapter,
  RuntimeEngineState,
} from "@/lib/precision/types";

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

  const enabledAccounts = settingsConfig.accounts.filter(
    (account) => account.enabled,
  );
  if (enabledAccounts.length === 0) {
    throw new Error("Enable at least one SLOW account before backtesting.");
  }

  console.log("params", params);

  // B. Getting klines to provide the runtime with klines data
  // preparing the klines first save to storage

  const state: RuntimeEngineState = {};
  const adapter: RuntimeEngineAdapter = {
    market: {
      getKlines: fetchKlinesFunction,
    },
    exchange: {
      getBalance() {
        return 0;
      },
    },
    onStrategy: () => {
      return true;
    },
    onAction: () => {
      return true;
    },
    onNotif: () => {
      return true;
    },
  };

  const backtestRuntimeEngine = new RuntimeEngine(state, adapter);

  res.json({
    data: true,
  });
}
