import type { NextApiRequest, NextApiResponse } from "next";

import production from "@/lib/production";
import { systemDashboard } from "@/lib/system/dashboard";
import { systemLog } from "@/lib/system/logging";
import managementAction from "@/lib/system/notification/management";
import { runtimeLogs, runtimeStorage } from "@/lib/system/storage";
import type { RuntimeCatalogUpdateInput } from "@/lib/system/storage";

async function loadDashboardState() {
  return systemDashboard.state.buildCombined({
    // PROD:DASHBOARD_PERSISTED_BALANCE
    refreshLiveBalance: false,
  });
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    // Ensure the background runtime singleton is initialized whenever the
    // dashboard storage endpoint is used.
    await production.runtime.get();

    if (req.method === "GET") {
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json(await loadDashboardState());
      return;
    }

    if (req.method === "PUT") {
      const body = (req.body ?? {}) as RuntimeCatalogUpdateInput;
      const previousCatalog = await runtimeStorage.catalog.ensure();
      const nextCatalog = await runtimeStorage.catalog.update({
        config: body.config,
        ...body,
        symbols: Array.isArray(body.symbols) ? body.symbols : undefined,
      });
      const managementSource = Array.isArray(body.symbols)
        ? "dashboard.coin-management"
        : "dashboard.settings.coin-management";
      const configChanges = runtimeStorage.catalog.diffConfig(
        previousCatalog.config,
        nextCatalog.config,
      );
      // PROD:CONFIG_CHANGE_LOG
      if (configChanges.length > 0) {
        await runtimeLogs
          .appendConfig({
            changes: configChanges,
            source: managementSource,
          })
          .catch((logError) => {
            systemLog.error(
              "[slow-trading] failed to persist config-change log",
              logError,
            );
          });
      }
      const managementActions = managementAction.build({
        previousSymbols: previousCatalog.config.management.symbols,
        nextSymbols: nextCatalog.config.management.symbols,
        reason: "Configured Symbols list was updated through the dashboard storage API.",
        source: managementSource,
      });

      if (managementActions.length > 0) {
        await Promise.all(
          managementActions.map((action) =>
            runtimeLogs.appendManagement({
              action: action.action,
              reason: action.reason,
              source: action.source,
              symbol: action.symbol,
              timestamp: action.t,
            }),
          ),
        ).catch((logError) => {
          systemLog.error(
            "[slow-trading] failed to persist management-action log",
            logError,
          );
        });

        const notification = nextCatalog.config.runtime.notification;
        if (notification) {
          await managementAction
            .notify({
              actions: managementActions,
              notification,
            })
            .catch((notificationError) => {
              systemLog.error(
                "[slow-trading] failed to send management-action notification",
                notificationError,
              );
            });
        }
      }

      res.status(200).json(await loadDashboardState());
      return;
    }

    res.setHeader("Allow", ["GET", "PUT"]);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  } catch (error: any) {
    await runtimeLogs
      .appendError({
        source: "api.system.storage",
        error,
        details: {
          method: req.method,
        },
      })
      .catch((logError) => {
        systemLog.error("[slow-trading] failed to write storage error log", logError);
      });
    res.status(500).json({
      error: error?.message ?? "Failed to handle slow trading storage",
    });
  }
}
