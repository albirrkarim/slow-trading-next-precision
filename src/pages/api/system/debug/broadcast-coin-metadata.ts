import type { NextApiRequest, NextApiResponse } from "next";

import { coinMetadataSync } from "@/lib/dev/coins/tag-sync";
import coinTags from "@/lib/dev/coins/tags";
import storageSync from "@/lib/dev/storage-sync";
import { systemLog } from "@/lib/system/logging";
import { runtimeLogs } from "@/lib/system/storage";

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

    const host = req.headers.host;
    if (!storageSync.isLocalCoinMetadataManualSyncAllowed(host)) {
      res.status(403).json({
        error:
          "Coin metadata broadcast is only allowed when APP_NAME=localhost on localhost outside Railway.",
      });
      return;
    }

    const state = coinTags.list();
    const results = await coinMetadataSync.broadcastToPeers(
      state,
      coinMetadataSync.manualPeers,
    );
    const failed = results.filter((result) => !result.success);

    res.status(200).json({
      failed,
      results,
      state,
      succeeded: results.filter((result) => result.success),
    });
  } catch (error: any) {
    await runtimeLogs
      .appendError({
        source: "api.system.debug.broadcast-coin-metadata",
        error,
        details: {
          method: req.method,
        },
      })
      .catch((logError) => {
        systemLog.error(
          "[slow-trading] failed to write coin metadata broadcast error log",
          logError,
        );
      });

    res.status(500).json({
      error: error?.message ?? "Failed to broadcast coin metadata",
    });
  }
}
