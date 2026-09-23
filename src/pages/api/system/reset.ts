import type { NextApiRequest, NextApiResponse } from "next";

import { systemDashboard } from "@/lib/system/dashboard";
import runtimeAccounts from "@/lib/system/runtime/accounts";
import { systemLog } from "@/lib/system/logging";
import { runtimeLogs, runtimeStorage } from "@/lib/system/storage";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", ["POST"]);
      res.status(405).end(`Method ${req.method} Not Allowed`);
      return;
    }

    const initialBalance =
      typeof req.body?.initialBalanceUSDT === "number"
        ? req.body.initialBalanceUSDT
        : undefined;
    const requestedAccount =
      typeof req.body?.account === "string" ? req.body.account : undefined;
    const catalog = await runtimeStorage.catalog.ensure();
    const account =
      catalog.config.accounts.find(
        (item) => item.slug === runtimeAccounts.slug.normalize(requestedAccount),
      ) ?? catalog.config.accounts[0];
    if (!account) {
      res.status(400).json({ error: "No accounts configured" });
      return;
    }

    await runtimeStorage.catalog.account.resetSandbox({
      account: account.slug,
      initialBalanceUSDT: initialBalance,
    });
    res
      .status(200)
      .json(
        await systemDashboard.state.buildRealtime({ account: account.slug }),
      );
  } catch (error: any) {
    await runtimeLogs
      .appendError({
        source: "api.system.reset",
        error,
        details: {
          method: req.method,
        },
      })
      .catch((logError) => {
        systemLog.error("[slow-trading] failed to write reset error log", logError);
      });
    res.status(500).json({
      error: error?.message ?? "Failed to reset sandbox state",
    });
  }
}
