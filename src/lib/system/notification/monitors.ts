import type { RuntimeContext } from "@/lib/precision/types";
import type { RuntimeMode } from "../runtime/types";
import { systemLog } from "../logging";
import { runtimeNotifications } from "../storage";
import type {
  HighVolatilityZone,
  RuntimeNotificationState,
} from "../storage/notifications";
import tradingReserve from "../trading/reserve";
import {
  getNotificationTypeConfig,
  normalizeHighVolatilityMinAbsoluteLevel,
  normalizeLongOpenPositionHour,
  normalizeStalePositionHour,
  type NotificationChannel,
} from "./config";
import systemNotif from "./index";

const NOTIFICATION_CHANNELS: NotificationChannel[] = ["telegram", "email"];
const HOUR_MS = 60 * 60 * 1000;

function normalizeSymbol(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/_USDT$/, "");
}

function modePrefix(mode: RuntimeMode): string {
  return mode === "sandbox" ? "[SANDBOX] " : "";
}

function formatElapsedHours(elapsedMs: number): string {
  return `${(elapsedMs / HOUR_MS).toFixed(2)} hours`;
}

/** Resolves the sign zone when a level breaches the channel threshold. */
function getHighVolatilityZone(
  level: number | undefined,
  minAbsoluteLevel: number,
): HighVolatilityZone | null {
  if (typeof level !== "number" || !Number.isFinite(level)) {
    return null;
  }

  if (Math.abs(level) < minAbsoluteLevel) {
    return null;
  }

  return level > 0 ? "POSITIVE" : "NEGATIVE";
}

// PROD:NOTIF_HIGH_VOLATILITY — one transition notification per channel,
// re-armed after the symbol drops back below that channel's absolute level.
async function notifyHighVolatilityLevels(params: {
  context: RuntimeContext;
  mode: RuntimeMode;
}): Promise<void> {
  const { context, mode } = params;
  const notification = context.state.config.runtime.notification;
  const exchangeType = context.state.config.management.exchangeType;
  const state = await runtimeNotifications.state.load(mode);
  const next: NonNullable<RuntimeNotificationState["highVolatility"]> = {
    ...(state.highVolatility ?? {}),
  };

  for (const channel of NOTIFICATION_CHANNELS) {
    const typeConfig = getNotificationTypeConfig(
      notification,
      channel,
      "NOTIF_HIGH_VOLATILITY",
    );

    if (!typeConfig) {
      next[channel] = {};
      continue;
    }

    const minAbsoluteLevel = normalizeHighVolatilityMinAbsoluteLevel(
      typeConfig.params?.level,
    );
    const channelState = {
      ...(state.highVolatility?.[channel] ?? {}),
    };

    for (const [rawSymbol, points] of Object.entries(
      context.state.vPointsMap,
    )) {
      const symbol = normalizeSymbol(rawSymbol);
      if (!symbol) continue;

      const latestPoint = points.at(-1);
      const zone = getHighVolatilityZone(latestPoint?.lvl, minAbsoluteLevel);
      const previousZone = channelState[symbol] ?? null;

      if (!zone) {
        delete channelState[symbol];
      } else if (previousZone !== zone) {
        channelState[symbol] = zone;
      }

      if (!zone || previousZone === zone) {
        continue;
      }

      const level = latestPoint?.lvl ?? 0;
      const label = latestPoint?.l ?? "UNKNOWN";
      await systemNotif.central({
        channel,
        dashboard: "SLOW",
        dedupeKey: [
          "slow-high-volatility",
          channel,
          exchangeType,
          minAbsoluteLevel,
          symbol,
          latestPoint?.id ?? latestPoint?.t ?? "unknown",
          level,
          label,
        ].join(":"),
        key: "NOTIF_HIGH_VOLATILITY",
        message: [
          `Symbol: ${symbol}`,
          `Exchange: ${exchangeType}`,
          `Threshold: abs(level) >= ${minAbsoluteLevel}`,
          `Level: ${level}`,
          `Label: ${label}`,
          `Price: ${
            typeof latestPoint?.p === "number" &&
            Number.isFinite(latestPoint.p)
              ? latestPoint.p.toFixed(6)
              : "-"
          }`,
          `Move: ${
            typeof latestPoint?.pct === "number" &&
            Number.isFinite(latestPoint.pct)
              ? `${latestPoint.pct.toFixed(2)}%`
              : "-"
          }`,
          `Time: ${
            typeof latestPoint?.t === "number"
              ? new Date(latestPoint.t).toISOString()
              : "-"
          }`,
        ].join("\n"),
        title: `[VOL] ${symbol} level ${level} ${label}`,
      });
    }

    next[channel] = channelState;
  }

  await runtimeNotifications.state.update(mode, (current) => {
    current.highVolatility = next;
  });
}

// PROD:NOTIF_STALE_POSITION — once per channel when an open position stays
// open beyond the channel's hours after its first post-entry target vPoint.
async function notifyStalePositions(params: {
  context: RuntimeContext;
  mode: RuntimeMode;
}): Promise<void> {
  const { context, mode } = params;
  const notification = context.state.config.runtime.notification;
  const exchangeType = context.state.config.management.exchangeType;
  const currentTimeMs = context.state.currentTime;
  const positions = context.state.openPositions.filter(
    (position) => !position.closed,
  );

  for (const position of positions) {
    const symbol = normalizeSymbol(position.symbol);
    if (!symbol) continue;

    const points = context.state.vPointsMap[position.symbol] ?? [];
    const targetPoint = tradingReserve.vpoints.findPositionTargetPoint({
      position,
      volatilityPoints: points,
    });
    if (!targetPoint || !Number.isFinite(targetPoint.t)) continue;

    const latestPoint = points.at(-1);
    const elapsedMs = currentTimeMs - targetPoint.t;
    const direction = position.direction;

    for (const channel of NOTIFICATION_CHANNELS) {
      const typeConfig = getNotificationTypeConfig(
        notification,
        channel,
        "NOTIF_STALE_POSITION",
      );
      if (!typeConfig) continue;

      const thresholdHour = normalizeStalePositionHour(
        typeConfig.params?.hour,
      );
      if (elapsedMs <= thresholdHour * HOUR_MS) continue;

      await systemNotif.central({
        channel,
        dashboard: "SLOW",
        dedupeKey: [
          "slow-stale-position",
          channel,
          mode,
          exchangeType,
          position.account,
          symbol,
          position.opened.t,
          targetPoint.id,
        ].join(":"),
        key: "NOTIF_STALE_POSITION",
        message: [
          `Symbol: ${symbol}`,
          `Mode: ${mode}`,
          `Exchange: ${exchangeType}`,
          `Direction: ${direction}`,
          `Entry time: ${new Date(position.opened.t).toISOString()}`,
          `Target vPoint: ${targetPoint.l}${Math.abs(targetPoint.lvl)}`,
          `Target time: ${new Date(targetPoint.t).toISOString()}`,
          `Threshold: more than ${thresholdHour} hour${
            thresholdHour === 1 ? "" : "s"
          }`,
          `Stale for: ${formatElapsedHours(elapsedMs)}`,
          `Current vPoint: ${
            latestPoint
              ? `${latestPoint.l}${Math.abs(latestPoint.lvl)} at ${new Date(
                  latestPoint.t,
                ).toISOString()}`
              : "-"
          }`,
        ].join("\n"),
        title: `${modePrefix(mode)}[STALE POSITION] ${symbol} ${direction}`,
      });
    }
  }
}

// PROD:NOTIF_LONG_OPEN_POSITION — once per channel when a position stays open
// beyond the channel's hours after its persisted entry time.
async function notifyLongOpenPositions(params: {
  context: RuntimeContext;
  mode: RuntimeMode;
}): Promise<void> {
  const { context, mode } = params;
  const notification = context.state.config.runtime.notification;
  const exchangeType = context.state.config.management.exchangeType;
  const currentTimeMs = context.state.currentTime;
  const positions = context.state.openPositions.filter(
    (position) => !position.closed,
  );

  for (const position of positions) {
    const symbol = normalizeSymbol(position.symbol);
    const entryTime = Number(position.opened.t);
    if (!symbol || !Number.isFinite(entryTime) || entryTime <= 0) continue;

    const elapsedMs = currentTimeMs - entryTime;
    const direction = position.direction;

    for (const channel of NOTIFICATION_CHANNELS) {
      const typeConfig = getNotificationTypeConfig(
        notification,
        channel,
        "NOTIF_LONG_OPEN_POSITION",
      );
      if (!typeConfig) continue;

      const thresholdHour = normalizeLongOpenPositionHour(
        typeConfig.params?.hour,
      );
      if (elapsedMs <= thresholdHour * HOUR_MS) continue;

      await systemNotif.central({
        channel,
        dashboard: "SLOW",
        dedupeKey: [
          "slow-long-open-position",
          channel,
          mode,
          exchangeType,
          position.account,
          symbol,
          position.opened.vPoint.id,
          entryTime,
        ].join(":"),
        key: "NOTIF_LONG_OPEN_POSITION",
        message: [
          `Symbol: ${symbol}`,
          `Mode: ${mode}`,
          `Exchange: ${exchangeType}`,
          `Direction: ${direction}`,
          `Entry time: ${new Date(entryTime).toISOString()}`,
          `Threshold: more than ${thresholdHour} hour${
            thresholdHour === 1 ? "" : "s"
          }`,
          `Open for: ${formatElapsedHours(elapsedMs)}`,
          `Margin: ${
            typeof position.exposure.marginUsdt === "number" &&
            Number.isFinite(position.exposure.marginUsdt)
              ? `$${position.exposure.marginUsdt.toFixed(2)}`
              : "-"
          }`,
        ].join("\n"),
        title: `${modePrefix(mode)}[LONG OPEN POSITION] ${symbol} ${direction}`,
      });
    }
  }
}

/**
 * Sends every configured post-exit monitoring notification for the open
 * positions that survived this cycle's exit processing, plus high-volatility
 * level transitions. Each evaluator is isolated so one failure cannot
 * suppress the others.
 */
async function run(params: {
  context: RuntimeContext;
  mode: RuntimeMode;
}): Promise<void> {
  if (params.context.adapter.onNotif?.() === false) return;

  const evaluators: Array<{
    name: string;
    fn: () => Promise<void>;
  }> = [
    {
      name: "high-volatility",
      fn: () => notifyHighVolatilityLevels(params),
    },
    {
      name: "stale-position",
      fn: () => notifyStalePositions(params),
    },
    {
      name: "long-open-position",
      fn: () => notifyLongOpenPositions(params),
    },
  ];

  for (const evaluator of evaluators) {
    try {
      await evaluator.fn();
    } catch (error) {
      systemLog.error(
        `[notification] ${evaluator.name} monitor failed`,
        error,
      );
    }
  }
}

/** Grouped open-position and volatility notification monitors. */
const monitorNotif = {
  run,
} as const;

export default monitorNotif;
export { monitorNotif };
