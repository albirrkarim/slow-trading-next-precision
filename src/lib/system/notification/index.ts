import { systemLog } from "../logging";
import type {
  NotificationChannel,
  NotificationDashboard,
} from "./config";

/**
 * Notification payload shared by every runtime environment. It carries the
 * same dashboard-routing fields as the production central sender so channel
 * selection and dedupe survive the port boundary.
 * Delivery is environment-owned: production registers the real central
 * sender at boot; tests and backtests keep the logging fallback.
 */
export interface SystemNotificationPayload {
  dashboard: NotificationDashboard;
  key: string;
  channel?: NotificationChannel;
  title: string;
  message: string;
  dedupeKey?: string;
}

type NotificationSender = (
  payload: SystemNotificationPayload,
) => Promise<void> | void;

const fallbackSender: NotificationSender = (payload) => {
  systemLog.warn(`[notification] ${payload.title}\n${payload.message}`);
};

let sender: NotificationSender = fallbackSender;

/** Registers the environment's real notification delivery once at boot. */
function register(fn: NotificationSender): void {
  sender = fn;
}

/** Resets delivery to the logging fallback (test isolation). */
function reset(): void {
  sender = fallbackSender;
}

/** Sends one notification through the registered environment sender. */
async function central(payload: SystemNotificationPayload): Promise<void> {
  await sender(payload);
}

const systemNotif = {
  central,
  register,
  reset,
} as const;

export default systemNotif;
export { systemNotif };

export type * from "./config";
export { default as systemNotifDelivery } from "./delivery";
export { default as runtimeNotifManagement } from "./management";
