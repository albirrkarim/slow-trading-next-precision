import type { NextApiRequest, NextApiResponse } from "next";

import production from "@/lib/production";
import { systemDashboard } from "@/lib/system/dashboard";
import { systemLog } from "@/lib/system/logging";
import { runtimeLogs, runtimeStorage } from "@/lib/system/storage";
import { blackSwan } from "@/lib/system/trading";

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
    const requestedSlug = String(req.body?.account || "").trim();
    const account = requestedSlug
      ? catalog.config.accounts.find((item) => item.slug === requestedSlug)
      : catalog.config.accounts[0];
    if (!account) {
      res.status(400).json({ error: "Account is required" });
      return;
    }
    if (!account.enabled) {
      res.status(409).json({
        error: `Account ${account.slug} is disabled for new entries`,
      });
      return;
    }

    const activeMode = catalog.mode;
    const [status, accountState] = await Promise.all([
      runtimeStorage.status.load(activeMode),
      runtimeStorage.account.load({
        accountSlug: account.slug,
        mode: activeMode,
      }),
    ]);

    const protectionState = status.blackSwan;
    if (blackSwan.state.isProtective(protectionState)) {
      res.status(423).json({
        error: `Entry blocked by Black Swan ${protectionState?.status}: ${protectionState?.reason}`,
      });
      return;
    }

    const hasOpenPosition = accountState.positions.some(
      (position) =>
        !position.closed && position.symbol.toUpperCase() === symbol,
    );
    if (hasOpenPosition) {
      res.status(409).json({
        error: `Open position already exists for ${symbol} in ${activeMode} mode`,
      });
      return;
    }

    const result = await production.manual.entry({
      accountSlug: account.slug,
      symbol,
    });
    const entryOutcome = result.entries.find(
      (item) => item.symbol === symbol,
    );

    res.status(200).json({
      success: true,
      executed: Boolean(entryOutcome?.executed),
      message:
        entryOutcome?.message ??
        `Manual entry for ${symbol} was skipped before order execution`,
      skippedReason: entryOutcome?.executed
        ? undefined
        : entryOutcome?.message,
      result,
      state: await systemDashboard.state.buildRealtime({
        account: account.slug,
      }),
    });
  } catch (error: any) {
    await runtimeLogs
      .appendError({
        source: "api.system.entry",
        error,
        details: {
          method: req.method,
          symbol: req.body?.symbol,
        },
      })
      .catch((logError) => {
        systemLog.error(
          "[slow-trading] failed to write entry error log",
          logError,
        );
      });

    res.status(500).json({
      error: error?.message ?? "Failed to entry slow trading position",
    });
  }
}
