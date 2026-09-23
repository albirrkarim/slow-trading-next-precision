import type { NextApiRequest, NextApiResponse } from "next";

import { systemDashboard } from "@/lib/system/dashboard";
import { systemLog } from "@/lib/system/logging";

import { runtimeLogs, runtimeStorage } from "@/lib/system/storage";
import type { RuntimeMode } from "@/lib/system/runtime";

function parseMode(value: unknown): RuntimeMode | null {
  return value === "live" || value === "sandbox" ? value : null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    if (req.method !== "DELETE" && req.method !== "PATCH") {
      res.setHeader("Allow", ["DELETE", "PATCH"]);
      res.status(405).end(`Method ${req.method} Not Allowed`);
      return;
    }

    const mode = parseMode(req.body?.mode);
    if (!mode) {
      res.status(400).json({ error: "Valid mode is required" });
      return;
    }

    if (req.method === "DELETE" && req.body?.clearAll === true) {
      const { deletedCount } = await runtimeStorage.history.clear(mode);
      res.status(200).json({
        success: true,
        deletedCount,
        state: await systemDashboard.state.buildCombined(),
      });
      return;
    }

    const symbol = String(req.body?.symbol || "").trim().toUpperCase();
    if (!symbol) {
      res.status(400).json({ error: "Symbol is required" });
      return;
    }

    const identity = {
      account: String(req.body?.account || "").trim(),
      entryId:
        typeof req.body?.entryId === "string" ? req.body.entryId : undefined,
      entryTime:
        typeof req.body?.entryTime === "number"
          ? req.body.entryTime
          : undefined,
      exitTime:
        typeof req.body?.exitTime === "number" ? req.body.exitTime : undefined,
      quantity:
        typeof req.body?.quantity === "number" ? req.body.quantity : undefined,
      usdt: typeof req.body?.usdt === "number" ? req.body.usdt : undefined,
    };
    if (!identity.account) {
      res.status(400).json({ error: "Account is required" });
      return;
    }

    if (req.method === "PATCH") {
      if (typeof req.body?.notes !== "string") {
        res.status(400).json({ error: "Notes must be a string" });
        return;
      }

      const { updated } = await runtimeStorage.history.updateNotes(
        mode,
        symbol,
        { ...identity, notes: req.body.notes },
      );

      if (!updated) {
        res.status(404).json({ error: `Trade history row not found for ${symbol}` });
        return;
      }

      res.status(200).json({
        success: true,
        state: await systemDashboard.state.buildCombined(),
      });
      return;
    }

    const { deleted } = await runtimeStorage.history.deleteEntry(
      mode,
      symbol,
      identity,
    );

    if (!deleted) {
      res.status(404).json({ error: `Trade history row not found for ${symbol}` });
      return;
    }

    res.status(200).json({
      success: true,
      deletedCount: 1,
      state: await systemDashboard.state.buildCombined(),
    });
  } catch (error: any) {
    await runtimeLogs
      .appendError({
        source: "api.system.history",
        error,
        details: {
          method: req.method,
          mode: req.body?.mode,
          symbol: req.body?.symbol,
        },
      })
      .catch((logError) => {
        systemLog.error("[slow-trading] failed to write history error log", logError);
      });
    res.status(500).json({
      error: error?.message ?? "Failed to update slow trading history",
    });
  }
}
