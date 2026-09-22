import type { NextApiRequest, NextApiResponse } from "next";

import slowTrading from "@/lib/slowTrading";
import { tradeLog } from "@/lib/trading/helper/log";
import type { PersistentStorageExportBundle } from "@/lib/slowTrading/debug-sync";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "100mb",
    },
  },
};

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

    // PROD:SYNC_LOCAL_TO_ONLINE
    const result = await slowTrading.debugSync.importPersistentStorageBundle(
      req.body as PersistentStorageExportBundle,
    );
    res.status(200).json(result);
  } catch (error: any) {
    await slowTrading.storage.logs
      .appendError({
        source: "api.slow-trading.debug.import",
        error,
        details: {
          method: req.method,
        },
      })
      .catch((logError) => {
        tradeLog.error(
          "[slow-trading] failed to write debug import error log",
          logError,
        );
      });

    res.status(500).json({
      error: error?.message ?? "Failed to import persistent storage",
    });
  }
}
