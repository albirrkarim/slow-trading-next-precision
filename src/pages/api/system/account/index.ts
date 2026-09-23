import type { NextApiRequest, NextApiResponse } from "next";

import production from "@/lib/production";
import runtimeAccounts from "@/lib/system/runtime/accounts";
import { systemLog } from "@/lib/system/logging";
import { runtimeLogs, runtimeStorage } from "@/lib/system/storage";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    await production.runtime.get();

    if (req.method === "GET") {
      const accounts = await runtimeStorage.catalog.accounts.list();
      res.status(200).json({ accounts });
      return;
    }

    if (req.method === "PUT") {
      const body = (req.body ?? {}) as {
        accounts?: unknown;
      };
      const catalog = await runtimeStorage.catalog.ensure();
      const currentAccounts = catalog.config.accounts;
      const requestedSlugs = new Set(
        (Array.isArray(body.accounts) ? body.accounts : [])
          .map((account) =>
            account && typeof account === "object"
              ? runtimeAccounts.slug.normalize(
                  (account as { slug?: unknown }).slug,
                )
              : "",
          )
          .filter(Boolean),
      );
      const removedAccounts = currentAccounts.filter(
        (account) => !requestedSlugs.has(account.slug),
      );

      // PROD:MULTI_ACCOUNT_DELETE_DEPENDENCY_GUARD
      for (const removed of removedAccounts) {
        const [liveState, sandboxState] = await Promise.all([
          runtimeStorage.account.load({
            accountSlug: removed.slug,
            mode: "live",
          }),
          runtimeStorage.account.load({
            accountSlug: removed.slug,
            mode: "sandbox",
          }),
        ]);
        const hasOpenPositions = [liveState, sandboxState].some((state) =>
          state.positions.some((position) => !position.closed),
        );
        const hasWithdrawalSchedule = (
          catalog.config.runtime.withdrawal?.schedules ?? []
        ).some((schedule) => schedule.account === removed.slug);
        if (hasOpenPositions || hasWithdrawalSchedule) {
          res.status(409).json({
            error:
              `Cannot delete account ${removed.slug}: resolve its ` +
              [
                hasOpenPositions ? "open positions" : "",
                hasWithdrawalSchedule ? "withdrawal schedules" : "",
              ]
                .filter(Boolean)
                .join(" and ") +
              " first.",
          });
          return;
        }
      }

      const accounts = await runtimeStorage.catalog.accounts.save(
        body.accounts,
      );
      for (const removed of removedAccounts) {
        await runtimeStorage.catalog.account.deleteState(removed.slug);
      }

      res.status(200).json({ accounts });
      return;
    }

    res.setHeader("Allow", ["GET", "PUT"]);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  } catch (error: any) {
    await runtimeLogs
      .appendError({
        source: "api.system.exchange-accounts",
        error,
        details: {
          method: req.method,
        },
      })
      .catch((logError) => {
        systemLog.error(
          "[slow-trading] failed to write exchange account error log",
          logError,
        );
      });
    res.status(500).json({
      error: error?.message ?? "Failed to handle exchange accounts",
    });
  }
}
