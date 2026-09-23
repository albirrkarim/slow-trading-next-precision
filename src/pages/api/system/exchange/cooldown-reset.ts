import type { NextApiRequest, NextApiResponse } from "next";

import { systemLog } from "@/lib/system/logging";
import { runtimeBinanceHealth, runtimeLogs } from "@/lib/system/storage";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    res.status(405).end(`Method ${req.method} Not Allowed`);
    return;
  }

  try {
    // PROD:BINANCE_MANUAL_COOLDOWN_RESET
    const health = await runtimeBinanceHealth.reset();
    res.status(200).json(health);
  } catch (error) {
    await runtimeLogs
      .appendError({
        source: "api.system.binance-cooldown-reset",
        error,
      })
      .catch((logError) => {
        systemLog.error(
          "[slow-trading] failed to write Binance cooldown reset error log",
          logError,
        );
      });
    res.status(500).json({
      error:
        error instanceof Error ? error.message : "Failed to reset Binance cooldown",
    });
  }
}
