import type { NextApiRequest, NextApiResponse } from "next";

import production from "@/lib/production";
import binanceRequestCoordinator from "@/lib/exchange/platform/binance/request-coordinator";
import { systemDashboard } from "@/lib/system/dashboard";
import { systemLog } from "@/lib/system/logging";
import runtimeAccounts from "@/lib/system/runtime/accounts";
import { runtimeLogs } from "@/lib/system/storage";

// PROD:SYNC_ENTRY_POSITION_FROM_EXCHANGE
// POST { account, action: "scan" } lists stored live positions the exchange no
// longer holds; POST { account, action: "clean", keys } removes those (after a
// fresh exchange check) and returns the refreshed dashboard state.
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    res.status(405).end(`Method ${req.method} Not Allowed`);
    return;
  }

  const account = runtimeAccounts.slug.normalize(
    typeof req.body?.account === "string" ? req.body.account : undefined,
  );
  const action = req.body?.action;
  try {
    if (!account) {
      res.status(400).json({ error: "Choose an account." });
      return;
    }
    if (action === "scan") {
      res.status(200).json({ scan: await production.staleLivePositions.scan(account) });
      return;
    }
    if (action === "clean") {
      const keys = Array.isArray(req.body?.keys)
        ? req.body.keys.filter((key: unknown): key is string => typeof key === "string")
        : [];
      if (keys.length === 0) {
        res.status(400).json({ error: "Choose at least one stale position to remove." });
        return;
      }
      const removed = await production.staleLivePositions.clean(account, keys);
      res.status(200).json({
        removed,
        state: await systemDashboard.state.buildRealtime({ account }),
      });
      return;
    }
    res.status(400).json({ error: "Action must be scan or clean." });
  } catch (error: any) {
    await runtimeLogs
      .appendError({
        source: "api.system.positions.stale-live",
        error,
        details: { account, action },
      })
      .catch((logError) => {
        systemLog.error("[precision] failed to write stale-live error log", logError);
      });
    const rateLimited = binanceRequestCoordinator.error.isRateLimit(error);
    res.status(rateLimited ? 429 : 500).json({
      error: error?.message ?? "Failed to check stale live positions",
    });
  }
}
