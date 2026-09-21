import type { NextApiRequest, NextApiResponse } from "next";
import slowTrading from "@/lib/slowTrading";
import { normalizeExchangeAccountSlug } from "@/lib/slowTrading/storage/account";
import { tradeLog } from "@/lib/trading/helper/log";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    await slowTrading.runner.get();

    if (req.method === "GET") {
      const accounts = await slowTrading.storage.account.loadAccounts();
      res.status(200).json({ accounts });
      return;
    }

    if (req.method === "PUT") {
      const body = (req.body ?? {}) as {
        accounts?: unknown;
      };
      const storage = await slowTrading.storage.data.load();
      const currentAccounts = storage.accounts;
      const requestedSlugs = new Set(
        (Array.isArray(body.accounts) ? body.accounts : [])
          .map((account) =>
            account && typeof account === "object"
              ? normalizeExchangeAccountSlug(
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
        const scoped = await slowTrading.storage.data.load({
          account: removed.slug,
          modeScope: "all",
        });
        const hasOpenPositions = (["live", "sandbox"] as const).some(
          (mode) => slowTrading.storage.history.getOpen(scoped, mode).length > 0,
        );
        const hasWithdrawalSchedule = storage.runtime.withdrawal.schedules.some(
          (schedule) => schedule.account === removed.slug,
        );
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

      const accounts = await slowTrading.storage.account.saveAccounts(
        body.accounts,
        storage.sharedConfig,
      );
      for (const removed of removedAccounts) {
        await slowTrading.storage.account.deleteState(removed.slug);
      }

      res.status(200).json({ accounts });
      return;
    }

    res.setHeader("Allow", ["GET", "PUT"]);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  } catch (error: any) {
    await slowTrading.storage.logs
      .appendError({
        source: "api.slow-trading.exchange-accounts",
        error,
        details: {
          method: req.method,
        },
      })
      .catch((logError) => {
        tradeLog.error(
          "[slow-trading] failed to write exchange account error log",
          logError,
        );
      });
    res.status(500).json({
      error: error?.message ?? "Failed to handle exchange accounts",
    });
  }
}
