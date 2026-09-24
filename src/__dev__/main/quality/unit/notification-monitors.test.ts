import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeContext } from "@/lib/precision/types";
import systemNotif from "@/lib/system/notification";
import { monitorNotif } from "@/lib/system/notification/monitors";
import type { DashboardNotificationConfig } from "@/lib/system/notification/config";
import { runtimeNotifications } from "@/lib/system/storage";
import type { RuntimeNotificationState } from "@/lib/system/storage/notifications";
import type { Position } from "@/lib/system/trading/types";
import type { VolatilityPoint } from "@/lib/system/types/market";

const HOUR_MS = 3_600_000;
const NOW = Date.UTC(2026, 8, 3, 10, 4);

let centralSpy: ReturnType<typeof vi.fn>;
let notifState: RuntimeNotificationState;

function notificationConfig(
  telegramTypes: Array<{ id: string; params?: Record<string, unknown> }>,
  emailTypes: Array<{ id: string; params?: Record<string, unknown> }> = [],
): DashboardNotificationConfig {
  return {
    email: { enabled: true, types: emailTypes as never },
    telegram: { enabled: true, types: telegramTypes as never },
  };
}

function createContext(params: {
  notification: DashboardNotificationConfig;
  onNotif?: () => boolean;
  openPositions?: Position[];
  vPointsMap?: Record<string, VolatilityPoint[]>;
}): RuntimeContext {
  return {
    adapter: { onNotif: params.onNotif ?? (() => true) },
    state: {
      config: {
        management: {
          exchangeType: "binance",
          symbols: [],
          tradingMode: "spot",
        },
        runtime: { notification: params.notification },
      },
      currentTime: NOW,
      openPositions: params.openPositions ?? [],
      vPointsMap: params.vPointsMap ?? {},
    },
  } as unknown as RuntimeContext;
}

function vPoint(overrides: Partial<VolatilityPoint>): VolatilityPoint {
  return {
    id: "T_p1",
    l: "T",
    lvl: 4,
    p: 150,
    pct: 8,
    t: NOW - HOUR_MS,
    vb: 0,
    ...overrides,
  } as VolatilityPoint;
}

function openPosition(overrides: Partial<Position> = {}): Position {
  return {
    account: "acc-1",
    closed: undefined,
    direction: "LONG",
    exposure: { marginUsdt: 40, quantity: 0.275 },
    opened: {
      price: 145.25,
      t: NOW - 3 * HOUR_MS,
      vPoint: { id: "T_entry_1", lvl: 2, t: NOW - 3 * HOUR_MS },
    },
    pnl: {},
    symbol: "SOL_USDT",
    ...overrides,
  } as unknown as Position;
}

function callsFor(key: string) {
  return centralSpy.mock.calls.filter(
    (call: any[]) => call[0]?.key === key,
  );
}

describe("monitorNotif", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    notifState = {};
    centralSpy = vi
      .spyOn(systemNotif, "central")
      .mockResolvedValue(true) as never;
    vi.spyOn(runtimeNotifications.state, "load").mockImplementation(
      async () => ({ ...notifState }),
    );
    vi.spyOn(runtimeNotifications.state, "update").mockImplementation(
      async (_mode, mutate) => {
        const next = { ...notifState };
        notifState = (mutate(next) as RuntimeNotificationState) ?? next;
        return notifState;
      },
    );
  });

  it("sends NOTIF_HIGH_VOLATILITY on a threshold crossing, once per zone", async () => {
    const context = createContext({
      notification: notificationConfig([
        { id: "NOTIF_HIGH_VOLATILITY", params: { level: 3 } },
      ]),
      vPointsMap: { SOL_USDT: [vPoint({ lvl: 4 })] },
    });

    await monitorNotif.run({ context, mode: "live" });

    // PROD:NOTIF_HIGH_VOLATILITY
    expect(callsFor("NOTIF_HIGH_VOLATILITY")).toHaveLength(1);
    expect(centralSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "telegram",
        key: "NOTIF_HIGH_VOLATILITY",
        title: "[VOL] SOL level 4 T",
      }),
    );

    // Same zone on the next pass: no repeat notification.
    await monitorNotif.run({ context, mode: "live" });
    expect(callsFor("NOTIF_HIGH_VOLATILITY")).toHaveLength(1);
  });

  it("resets the high-volatility state after the symbol drops below the level", async () => {
    const context = createContext({
      notification: notificationConfig([
        { id: "NOTIF_HIGH_VOLATILITY", params: { level: 3 } },
      ]),
      vPointsMap: { SOL_USDT: [vPoint({ lvl: 4 })] },
    });

    await monitorNotif.run({ context, mode: "live" });
    expect(notifState.highVolatility?.telegram?.SOL).toBe("POSITIVE");

    // Below threshold: state clears so the next crossing notifies again.
    context.state.vPointsMap.SOL_USDT.push(
      vPoint({ id: "B_p2", l: "B", lvl: -1 }),
    );
    await monitorNotif.run({ context, mode: "live" });
    expect(notifState.highVolatility?.telegram?.SOL).toBeUndefined();
    expect(callsFor("NOTIF_HIGH_VOLATILITY")).toHaveLength(1);

    // A crossing to the opposite zone is a new transition.
    context.state.vPointsMap.SOL_USDT.push(
      vPoint({ id: "B_p3", l: "B", lvl: -4 }),
    );
    await monitorNotif.run({ context, mode: "live" });
    expect(callsFor("NOTIF_HIGH_VOLATILITY")).toHaveLength(2);
    expect(notifState.highVolatility?.telegram?.SOL).toBe("NEGATIVE");
  });

  it("applies each channel's own high-volatility threshold", async () => {
    const context = createContext({
      notification: notificationConfig(
        [{ id: "NOTIF_HIGH_VOLATILITY", params: { level: 3 } }],
        [{ id: "NOTIF_HIGH_VOLATILITY", params: { level: 5 } }],
      ),
      vPointsMap: { SOL_USDT: [vPoint({ lvl: 4 })] },
    });

    await monitorNotif.run({ context, mode: "live" });

    const calls = callsFor("NOTIF_HIGH_VOLATILITY");
    expect(calls).toHaveLength(1);
    expect(calls[0][0].channel).toBe("telegram");
  });

  it("sends NOTIF_STALE_POSITION after the channel's hour past the target vPoint", async () => {
    const context = createContext({
      notification: notificationConfig([
        { id: "NOTIF_STALE_POSITION", params: { hour: 1 } },
      ]),
      openPositions: [openPosition()],
      vPointsMap: {
        SOL_USDT: [
          vPoint({ id: "T_target", l: "T", lvl: 2, t: NOW - 2 * HOUR_MS }),
        ],
      },
    });

    await monitorNotif.run({ context, mode: "sandbox" });

    // PROD:NOTIF_STALE_POSITION — sandbox subjects carry the prefix.
    expect(centralSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "NOTIF_STALE_POSITION",
        title: "[SANDBOX] [STALE POSITION] SOL LONG",
      }),
    );
  });

  it("stays quiet before the stale threshold and before the long-open threshold", async () => {
    const context = createContext({
      notification: notificationConfig([
        { id: "NOTIF_STALE_POSITION", params: { hour: 3 } },
        { id: "NOTIF_LONG_OPEN_POSITION", params: { hour: 4 } },
      ]),
      openPositions: [openPosition()],
      vPointsMap: {
        SOL_USDT: [
          vPoint({ id: "T_target", l: "T", lvl: 2, t: NOW - 2 * HOUR_MS }),
        ],
      },
    });

    await monitorNotif.run({ context, mode: "live" });

    expect(callsFor("NOTIF_STALE_POSITION")).toHaveLength(0);
    expect(callsFor("NOTIF_LONG_OPEN_POSITION")).toHaveLength(0);
  });

  it("sends NOTIF_LONG_OPEN_POSITION once past the channel's entry-time hours", async () => {
    const context = createContext({
      notification: notificationConfig([
        { id: "NOTIF_LONG_OPEN_POSITION", params: { hour: 2 } },
      ]),
      openPositions: [openPosition()],
    });

    await monitorNotif.run({ context, mode: "live" });

    // PROD:NOTIF_LONG_OPEN_POSITION
    expect(centralSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "NOTIF_LONG_OPEN_POSITION",
        title: "[LONG OPEN POSITION] SOL LONG",
      }),
    );
  });

  it("skips positions that are already closed", async () => {
    const closed = openPosition({
      closed: { feeUsdt: 0, price: 1, reason: "TAKE_PROFIT", t: NOW },
    } as Partial<Position>);
    const context = createContext({
      notification: notificationConfig([
        { id: "NOTIF_LONG_OPEN_POSITION", params: { hour: 1 } },
      ]),
      openPositions: [closed],
    });

    await monitorNotif.run({ context, mode: "live" });
    expect(callsFor("NOTIF_LONG_OPEN_POSITION")).toHaveLength(0);
  });

  it("honors the adapter onNotif gate", async () => {
    const context = createContext({
      notification: notificationConfig([
        { id: "NOTIF_LONG_OPEN_POSITION", params: { hour: 1 } },
      ]),
      onNotif: () => false,
      openPositions: [openPosition()],
    });

    await monitorNotif.run({ context, mode: "live" });
    expect(centralSpy).not.toHaveBeenCalled();
  });
});
