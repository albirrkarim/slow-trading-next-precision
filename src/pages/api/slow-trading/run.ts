import type { NextApiRequest, NextApiResponse } from "next";
import production from "@/lib/production";
import { systemLog } from "@/lib/system/logging";
import { runtimeLogs } from "@/lib/system/storage";

function parseOptionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }

  return undefined;
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

    const result = await production.manual.run({
      bypass: parseOptionalBoolean(req.body?.bypass),
    });

    res.status(200).json(result);
  } catch (error: any) {
    await runtimeLogs
      .appendError({
        source: "api.slow-trading.run",
        error,
        details: {
          method: req.method,
        },
      })
      .catch((logError) => {
        systemLog.error(
          "[slow-trading] failed to write run error log",
          logError,
        );
      });

    res.status(500).json({
      error: error?.message ?? "Failed to run slow trading cycle",
    });
  }
}
