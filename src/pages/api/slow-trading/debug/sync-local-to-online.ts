import type { NextApiRequest, NextApiResponse } from "next";

import slowTrading from "@/lib/slowTrading";
import { tradeLog } from "@/lib/trading/helper/log";

interface SyncLocalToOnlineBody {
  onlineBaseUrl?: string;
}

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

    const body = (req.body ?? {}) as SyncLocalToOnlineBody;
    const result =
      await slowTrading.debugSync.pushLocalPersistentStorageToOnline({
        onlineBaseUrl: body.onlineBaseUrl,
        token: process.env.SYNC_TOKEN,
      });

    // PROD:SYNC_LOCAL_TO_ONLINE
    res.status(200).json(result);
  } catch (error: any) {
    await slowTrading.storage.logs
      .appendError({
        source: "api.slow-trading.debug.sync-local-to-online",
        error,
        details: {
          method: req.method,
        },
      })
      .catch((logError) => {
        tradeLog.error(
          "[slow-trading] failed to write debug push error log",
          logError,
        );
      });

    res.status(500).json({
      error:
        error?.message ?? "Failed to push local persistent storage online",
    });
  }
}
