import production from "@/lib/production";
import type { RuntimeMode } from "@/lib/system/runtime";
import type {
  RuntimeAccountExecutionError,
  RuntimeEntryDiagnosticsSnapshot,
} from "@/lib/system/trading";
import { entryDiagnostics } from "@/lib/system/trading";
import { runtimeDailyPnlLimit } from "@/lib/system/trading/daily-pnl-limit";
import { systemLog } from "@/lib/system/logging";
import { runtimeLogs, runtimeStorage } from "@/lib/system/storage";
import binanceRequestCoordinator, {
  BinanceCooldownError,
} from "@/lib/exchange/platform/binance/request-coordinator";
import type { NextApiRequest, NextApiResponse } from "next";

interface EntryDiagnosticsErrorResponse {
  error: string;
  retryAt?: number;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<
    RuntimeEntryDiagnosticsSnapshot | EntryDiagnosticsErrorResponse
  >,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    return;
  }

  res.setHeader("Cache-Control", "no-store");

  const activeCooldown = binanceRequestCoordinator.cooldown.get();
  if (activeCooldown) {
    res.status(503).json({
      error: "Binance cooldown",
      retryAt: activeCooldown.retryAt,
    });
    return;
  }

  try {
    const runtime = production.runtime.get();
    const snapshot = await runtime.runManual(async (context) => {
      const mode: RuntimeMode =
        context.state.mode === "live" ? "live" : "sandbox";
      const [status, logs] = await Promise.all([
        runtimeStorage.status.load(mode),
        runtimeLogs.load(),
      ]);
      const latestErrors = new Map<string, RuntimeAccountExecutionError>();
      for (const entry of logs.errors) {
        if (entry.status !== "new") continue;
        const match = /^cycle\.account\.(.+)$/.exec(entry.source);
        if (!match || latestErrors.has(match[1])) continue;
        latestErrors.set(match[1], {
          createdAt: entry.createdAt,
          id: entry.id,
          message: entry.message,
        });
      }

      const limitState = status.dailyPnlLimitState;
      const dailyPnlLimit = limitState
        ? runtimeDailyPnlLimit.guard.evaluatePnl({
            currentTimeMs: context.state.currentTime,
            pnlUsdt: limitState.usdt,
            thresholdUsdt:
              context.state.config.runtime.autoEntryDailyPnlLimitUSDT,
          })
        : undefined;

      return entryDiagnostics.build(context, {
        blackSwan: status.blackSwan,
        dailyPnlLimit:
          dailyPnlLimit && dailyPnlLimit.day === limitState?.d
            ? dailyPnlLimit
            : undefined,
        latestErrors,
      });
    });

    res.status(200).json(snapshot);
  } catch (error: any) {
    if (error instanceof BinanceCooldownError) {
      res.status(503).json({
        error: "Binance cooldown",
        retryAt: error.retryAt,
      });
      return;
    }

    await runtimeLogs
      .appendError({
        source: "api.system.entry-diagnostics",
        error,
        details: {
          method: req.method,
        },
      })
      .catch((logError) => {
        systemLog.error(
          "[slow-trading] failed to write entry diagnostics error log",
          logError,
        );
      });
    res.status(500).json({
      error: error?.message ?? "Failed to build entry diagnostics",
    });
  }
}
