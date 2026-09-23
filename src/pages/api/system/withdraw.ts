import type { NextApiRequest, NextApiResponse } from "next";

import { runtimeWithdrawal } from "@/lib/system/withdrawal";
import type { RuntimeWithdrawalExecutionResult } from "@/lib/system/withdrawal";
import { systemLog } from "@/lib/system/logging";
import { runtimeLogs } from "@/lib/system/storage";


type WithdrawRequestBody = {
  scheduleId?: string;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<RuntimeWithdrawalExecutionResult | { error: string }>,
) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", ["POST"]);
      res.status(405).json({ error: `Method ${req.method} not allowed` });
      return;
    }

    const body = (req.body ?? {}) as WithdrawRequestBody;
    const scheduleId = String(body.scheduleId ?? "").trim();
    if (!scheduleId) {
      res.status(400).json({ error: "Please choose which withdrawal schedule to run." });
      return;
    }

    const result = await runtimeWithdrawal.schedules.execute({
      scheduleId,
    });
    res.status(200).json(result);
  } catch (error: any) {
    await runtimeLogs
      .appendError({
        source: "api.system.withdraw",
        error,
        details: {
          method: req.method,
          scheduleId: req.body?.scheduleId,
        },
      })
      .catch((logError) => {
        systemLog.error("[slow-trading] failed to write withdrawal error log", logError);
      });
    res.status(500).json({
      error: error?.message ?? "Failed to try slow trading withdraw flow",
    });
  }
}
