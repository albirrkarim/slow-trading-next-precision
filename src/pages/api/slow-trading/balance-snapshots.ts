import type { NextApiRequest, NextApiResponse } from "next";

import { systemLog } from "@/lib/system/logging";
import { runtimeBalanceSnapshots, runtimeLogs, runtimeStorage } from "@/lib/system/storage";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ error: "Method not allowed" });
    }

    const requestedModeRaw = req.query.mode;
    const requestedMode = Array.isArray(requestedModeRaw)
      ? requestedModeRaw[0]
      : requestedModeRaw;
    const catalog = await runtimeStorage.catalog.ensure();
    const resolvedMode =
      requestedMode === "sandbox" || requestedMode === "live"
        ? requestedMode
        : catalog.mode;
    const enabledAccounts = catalog.config.accounts
      .filter((account) => account.enabled)
      .map((account) => account.slug);
    const snapshots = await runtimeBalanceSnapshots.readCombined({
      accounts: enabledAccounts,
      mode: resolvedMode,
    });

    return res.status(200).json(snapshots);
  } catch (error: any) {
    systemLog.error("[slow-trading] Failed to read balance snapshots", error);
    await runtimeLogs
      .appendError({
        source: "api.slow-trading.balance-snapshots",
        error,
        details: {
          method: req.method,
          mode: req.query.mode,
        },
      })
      .catch((logError) => {
        systemLog.error(
          "[slow-trading] failed to write balance snapshots error log",
          logError,
        );
      });
    return res.status(500).json({ error: error.message ?? "Unknown error" });
  }
}
