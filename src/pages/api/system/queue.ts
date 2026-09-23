import type { NextApiRequest, NextApiResponse } from "next";

import { runtimeQueue } from "@/lib/system/queue";
import type { RuntimeManualQueueCreateInput, RuntimeQueueItem, RuntimeQueueKind, RuntimeQueues } from "@/lib/system/queue";
import { systemLog } from "@/lib/system/logging";
import { runtimeLogs } from "@/lib/system/storage";


type RuntimeQueueResponse =
  | RuntimeQueues
  | RuntimeQueueItem
  | { deleted: boolean; id: string; kind: RuntimeQueueKind }
  | { error: string };

/** Parses the dashboard queue discriminator. */
function parseQueueKind(value: unknown): RuntimeQueueKind | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === "safe_haven" || raw === "withdrawal") {
    return raw;
  }

  return null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<RuntimeQueueResponse>,
) {
  try {
    if (req.method === "GET") {
      res.status(200).json(await runtimeQueue.items.load());
      return;
    }

    if (req.method === "POST") {
      const body = (req.body ?? {}) as Partial<RuntimeManualQueueCreateInput>;

      if (body.kind === "safe_haven") {
        const item = await runtimeQueue.items.createManual({
          kind: "safe_haven",
          amountUSDT: Number(body.amountUSDT),
        });
        res.status(201).json(item);
        return;
      }

      if (body.kind === "withdrawal") {
        const item = await runtimeQueue.items.createManual({
          kind: "withdrawal",
          scheduleId: String(body.scheduleId ?? "").trim(),
        });
        res.status(201).json(item);
        return;
      }

      res.status(400).json({ error: "Queue kind is required." });
      return;
    }

    if (req.method === "DELETE") {
      const kind = parseQueueKind(req.query.kind);
      const rawId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
      const id = String(rawId ?? "").trim();

      if (!kind) {
        res.status(400).json({ error: "Queue kind is required." });
        return;
      }

      if (!id) {
        res.status(400).json({ error: "Queue id is required." });
        return;
      }

      const deleted = await runtimeQueue.items.cancel(kind, id);
      if (!deleted) {
        res.status(404).json({ error: "Queue item was not found." });
        return;
      }

      res.status(200).json({ deleted, id, kind });
      return;
    }

    res.setHeader("Allow", ["GET", "POST", "DELETE"]);
    res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  } catch (error) {
    await runtimeLogs
      .appendError({
        source: "api.system.queue",
        error,
        details: {
          method: req.method,
        },
      })
      .catch((logError) => {
        systemLog.error(
          "[slow-trading] failed to write queue API error log",
          logError,
        );
      });
    res.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : "Failed to handle slow trading queue.",
    });
  }
}
