import fs from "fs-extra";

import { systemLog } from "../logging";
import type { NotificationChannel } from "../notification/config";
import type { RuntimeMode } from "../runtime/types";
import storageFiles from "./files";
import jsonFile from "./json-file";

/**
 * High-volatility sign zone persisted per channel and symbol so the
 * transition notification fires once per crossing and re-arms after the
 * symbol drops back below the channel's configured absolute level.
 */
export type HighVolatilityZone = "POSITIVE" | "NEGATIVE";

/**
 * Per-mode notification transition state persisted in `notifications.json`.
 * One-shot alerts (stale/long-open) rely on the dedupe store instead; only
 * re-armable transition state lives here.
 */
export interface RuntimeNotificationState {
  highVolatility?: Partial<
    Record<NotificationChannel, Record<string, HighVolatilityZone>>
  >;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Loads the notification state slice for one mode; `{}` when absent. */
async function load(mode: RuntimeMode): Promise<RuntimeNotificationState> {
  try {
    if (!(await fs.pathExists(storageFiles.prod.notifications))) {
      return {};
    }
    const raw = await fs.readJSON(storageFiles.prod.notifications);
    const slice = isRecord(raw) ? raw[mode] : undefined;
    return isRecord(slice) ? (slice as RuntimeNotificationState) : {};
  } catch (error) {
    systemLog.error("[runtimeNotifications] failed to read state", error);
    return {};
  }
}

/**
 * Atomically reads, mutates, and persists the notification state slice for
 * one mode. Serialized per file so concurrent mutations never interleave.
 */
async function update(
  mode: RuntimeMode,
  mutate: (state: RuntimeNotificationState) => RuntimeNotificationState | void,
): Promise<RuntimeNotificationState> {
  let nextState: RuntimeNotificationState = {};
  await jsonFile.update.atomic(storageFiles.prod.notifications, (raw) => {
    const file = isRecord(raw) ? raw : {};
    const current = isRecord(file[mode])
      ? (file[mode] as RuntimeNotificationState)
      : {};
    const next = { ...current };
    const result = mutate(next);
    nextState = isRecord(result)
      ? (result as RuntimeNotificationState)
      : next;
    return { ...file, [mode]: nextState };
  });
  return nextState;
}

/** Grouped notification-state storage API. */
const runtimeNotifications = {
  state: { load, update },
} as const;

export default runtimeNotifications;
export { runtimeNotifications };
