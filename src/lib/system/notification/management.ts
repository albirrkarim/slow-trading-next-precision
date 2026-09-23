import systemNotif from "./index";
import {
  getNotificationTypeConfig,
  type DashboardNotificationConfig,
  type NotificationChannel,
} from "./config";

const NOTIFICATION_CHANNELS: NotificationChannel[] = ["telegram", "email"];

/** One configured-symbol add/remove action detected by the dashboard. */
export interface RuntimeManagementAction {
  action: "add" | "remove";
  reason: string;
  source: string;
  symbol: string;
  t?: number;
}

function normalizeSymbol(value: unknown): string {
  return String(value || "")
    .trim()
    .toUpperCase();
}

/**
 * Builds symbol-management actions by comparing the configured list before and
 * after one mutation.
 */
function build(params: {
  previousSymbols: string[];
  nextSymbols: string[];
  reason: string;
  source: string;
  t?: number;
}): RuntimeManagementAction[] {
  const previousSymbols = new Set(
    params.previousSymbols.map(normalizeSymbol).filter(Boolean),
  );
  const nextSymbols = new Set(
    params.nextSymbols.map(normalizeSymbol).filter(Boolean),
  );
  const actions: RuntimeManagementAction[] = [];

  for (const symbol of nextSymbols) {
    if (!previousSymbols.has(symbol)) {
      actions.push({
        action: "add",
        reason: params.reason,
        source: params.source,
        symbol,
        t: params.t,
      });
    }
  }

  for (const symbol of previousSymbols) {
    if (!nextSymbols.has(symbol)) {
      actions.push({
        action: "remove",
        reason: params.reason,
        source: params.source,
        symbol,
        t: params.t,
      });
    }
  }

  return actions;
}

/** Sends configured symbol-management actions to each eligible channel. */
async function notify(params: {
  actions: RuntimeManagementAction[];
  notification: DashboardNotificationConfig;
}): Promise<void> {
  for (const action of params.actions) {
    const symbol = normalizeSymbol(action.symbol);
    if (!symbol) {
      continue;
    }

    const t = Number.isFinite(action.t) ? Number(action.t) : Date.now();

    for (const channel of NOTIFICATION_CHANNELS) {
      const typeConfig = getNotificationTypeConfig(
        params.notification,
        channel,
        "NOTIF_MANAGEMENT_ACTION",
      );
      if (!typeConfig) {
        continue;
      }

      const actionEnabled =
        action.action === "add"
          ? (typeConfig.params?.add ?? true)
          : (typeConfig.params?.remove ?? true);
      if (!actionEnabled) {
        continue;
      }

      await systemNotif.central({
        dashboard: "SLOW",
        channel,
        // PROD:NOTIF_MANAGEMENT_ACTION
        key: "NOTIF_MANAGEMENT_ACTION",
        dedupeKey: [
          "slow-management-action",
          channel,
          action.action,
          symbol,
          action.source,
          t,
        ].join(":"),
        title: `[MANAGEMENT] ${action.action.toUpperCase()} ${symbol}`,
        message: [
          `Action: ${action.action.toUpperCase()}`,
          `Symbol: ${symbol}`,
          `Source: ${action.source}`,
          `Reason: ${action.reason}`,
          `Time: ${new Date(t).toISOString()}`,
        ].join("\n"),
      });
    }
  }
}

/** Grouped configured-symbol management notification helpers. */
const managementAction = {
  build,
  notify,
} as const;

export default managementAction;
export { managementAction };
