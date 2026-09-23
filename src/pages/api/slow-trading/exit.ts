import type { NextApiRequest, NextApiResponse } from "next";

import production from "@/lib/production";
import { systemDashboard } from "@/lib/system/dashboard";
import { systemLog } from "@/lib/system/logging";
import { runtimeLogs, runtimeStorage } from "@/lib/system/storage";

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

    const symbol = String(req.body?.symbol || "").trim().toUpperCase();
    if (!symbol) {
      res.status(400).json({ error: "Symbol is required" });
      return;
    }

    const catalog = await runtimeStorage.catalog.load();
    const activeMode = catalog.mode;
    const requestedSlug = String(req.body?.account || "").trim();
    const account = requestedSlug
      ? catalog.config.accounts.find((item) => item.slug === requestedSlug)
      : catalog.config.accounts[0];
    if (!account) {
      res.status(400).json({ error: "Account is required" });
      return;
    }

    const accountState = await runtimeStorage.account.load({
      accountSlug: account.slug,
      mode: activeMode,
    });
    const hasOpenPosition = accountState.positions.some(
      (position) =>
        !position.closed && position.symbol.toUpperCase() === symbol,
    );
    if (!hasOpenPosition) {
      res.status(404).json({
        error: `No open position found for ${symbol} in ${activeMode} mode`,
      });
      return;
    }

    const result = await production.manual.exit({
      accountSlug: account.slug,
      symbol,
    });

    res.status(200).json({
      success: true,
      result,
      state: await systemDashboard.state.buildRealtime({
        account: account.slug,
      }),
    });
  } catch (error: any) {
    await runtimeLogs
      .appendError({
        source: "api.slow-trading.exit",
        error,
        details: {
          method: req.method,
          symbol: req.body?.symbol,
        },
      })
      .catch((logError) => {
        systemLog.error(
          "[slow-trading] failed to write exit error log",
          logError,
        );
      });

    res.status(500).json({
      error: error?.message ?? "Failed to exit slow trading position",
    });
  }
}
