import type { NextApiRequest, NextApiResponse } from "next";

import storageSync from "@/lib/dev/storage-sync";
import { systemLog } from "@/lib/system/logging";
import { runtimeLogs } from "@/lib/system/storage";

interface SyncOnlineToLocalBody {
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

    const body = (req.body ?? {}) as SyncOnlineToLocalBody;
    const result =
      await storageSync.syncOnlinePersistentStorageToLocal({
        onlineBaseUrl: body.onlineBaseUrl,
        token: process.env.SYNC_TOKEN,
      });

    // PROD:SYNC_ONLINE_TO_LOCAL
    res.status(200).json(result);
  } catch (error: any) {
    await runtimeLogs
      .appendError({
        source: "api.system.debug.sync-online-to-local",
        error,
        details: {
          method: req.method,
        },
      })
      .catch((logError) => {
        systemLog.error(
          "[slow-trading] failed to write debug sync error log",
          logError,
        );
      });

    res.status(500).json({
      error:
        error?.message ?? "Failed to sync online persistent storage to local",
    });
  }
}
