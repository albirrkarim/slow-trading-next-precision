import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeContext } from "@/lib/precision/types";
import systemNotif from "@/lib/system/notification";
import { tradeNotif } from "@/lib/system/notification/trades";
import type { Position } from "@/lib/system/trading/types";

const NOW = Date.UTC(2026, 8, 3, 10, 4);

function createContext(onNotif: () => boolean = () => true): RuntimeContext {
  return {
    adapter: { onNotif },
    state: {
      config: {
        management: { exchangeType: "binance", symbols: [], tradingMode: "futures" },
      },
      currentTime: NOW,
    },
  } as unknown as RuntimeContext;
}

function createPosition(overrides: Partial<Position> = {}): Position {
  return {
    account: "acc-1",
    closed: undefined,
    direction: "LONG",
    executionMode: "live",
    exposure: {
      averageEntryPrice: 145.25,
      leverage: 5,
      marginUsdt: 40,
      notionalUsdt: 40,
      quantity: 0.275,
    },
    fees: { entryUsdt: 0.4 },
    opened: {
      message: "",
      price: 145.25,
      reason: "AUTO",
      t: NOW - 60_000,
      vPoint: { id: "T_abc_1", lvl: 3, t: NOW - 60_000 },
    },
    pnl: {},
    strategy: {
      averaging: {
        entryLevel: 1,
        lastHandledLevel: 1,
        reserveBaseMarginUsdt: 40,
        reservedRemainingMarginUsdt: 0,
        steps: [],
      },
      entry: {},
    },
    symbol: "SOL_USDT",
    tradingMode: "futures",
    ...overrides,
  } as unknown as Position;
}

const ENTRY_DECISION = {
  accountSlug: "acc-1",
  direction: "LONG",
  entrySignal: {},
  message: "vPoint T3 crossed",
  symbol: "SOL_USDT",
  type: "entry",
} as const;

const EXIT_DECISION = {
  accountSlug: "acc-1",
  message: "stop loss",
  position: null,
  symbol: "SOL_USDT",
  tradeDecision: { action: "SELL" },
  type: "exit",
} as const;

describe("tradeNotif", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends NOTIF_ENTRY with the executed fill details", async () => {
    const central = vi
      .spyOn(systemNotif, "central")
      .mockResolvedValue(true);

    await tradeNotif.executed({
      context: createContext(),
      decision: ENTRY_DECISION as never,
      mode: "live",
      position: createPosition(),
    });

    // PROD:NOTIF_ENTRY
    expect(central).toHaveBeenCalledWith(
      expect.objectContaining({
        dashboard: "SLOW",
        key: "NOTIF_ENTRY",
        title:
          "[ENTRY] | SOL LONG | USDT: $40.00 @ Price: $145.25000 | " +
          "Quantity: 0.275 | Leverage: 5x | binance:futures",
      }),
    );
    expect(central).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining("SANDBOX") }),
    );
  });

  it("prefixes the sandbox entry subject with [SANDBOX]", async () => {
    const central = vi
      .spyOn(systemNotif, "central")
      .mockResolvedValue(true);

    await tradeNotif.executed({
      context: createContext(),
      decision: ENTRY_DECISION as never,
      mode: "sandbox",
      position: createPosition(),
    });

    expect(central).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "NOTIF_ENTRY",
        title: expect.stringMatching(/^\[SANDBOX\] \[ENTRY\]/),
      }),
    );
  });

  it("sends NOTIF_EXIT with net PnL details for a closed position", async () => {
    const central = vi
      .spyOn(systemNotif, "central")
      .mockResolvedValue(true);

    await tradeNotif.executed({
      context: createContext(),
      decision: EXIT_DECISION as never,
      mode: "live",
      position: createPosition({
        closed: {
          feeUsdt: 0.08,
          message: "",
          price: 149.61,
          reason: "TAKE_PROFIT",
          t: NOW,
        },
        pnl: { netPct: 2.98, netUsdt: 1.12 },
      }),
    });

    // PROD:NOTIF_EXIT — Profit is gross (net + fees), USDT Profit is net.
    expect(central).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "NOTIF_EXIT",
        title:
          "[SELL] | SOL LONG | Profit: $1.60 | USDT Profit: $1.12 | " +
          "Entry: $145.25000 Current: $149.61000 | Gain: 2.98%",
      }),
    );
  });

  it("sends NOTIF_AVERAGE with the completed execution level", async () => {
    const central = vi
      .spyOn(systemNotif, "central")
      .mockResolvedValue(true);

    await tradeNotif.executed({
      context: createContext(),
      decision: {
        accountSlug: "acc-1",
        message: "averaging level 2",
        position: null,
        recommendation: {},
        symbol: "SOL_USDT",
        type: "averaging",
      } as never,
      mode: "sandbox",
      position: createPosition({
        strategy: {
          averaging: {
            entryLevel: 1,
            executions: [
              {
                allocationPct: 30,
                level: 2,
                marginUsdt: 12,
                price: 139.8,
                t: NOW - 5_000,
              },
            ],
            lastHandledLevel: 2,
            reserveBaseMarginUsdt: 40,
            reservedRemainingMarginUsdt: 0,
            steps: [],
          },
          entry: {},
        },
      }),
    });

    // PROD:NOTIF_AVG
    expect(central).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "NOTIF_AVERAGE",
        title:
          "[SANDBOX] [ADD POSITION] | SOL LONG | Level 2 | " +
          "Margin: $12.00 @ $139.80000",
      }),
    );
  });

  it("sends the *_FAILED variant when execution produced no position", async () => {
    const central = vi
      .spyOn(systemNotif, "central")
      .mockResolvedValue(true);

    await tradeNotif.failed({
      context: createContext(),
      decision: EXIT_DECISION as never,
      error: new Error("exchange did not confirm close"),
      mode: "live",
    });

    // PROD:NOTIF_EXIT_FAILED
    expect(central).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "NOTIF_EXIT_FAILED",
        message: expect.stringContaining("exchange did not confirm close"),
        title: "EXIT ORDER FAILED",
      }),
    );
  });

  it("sends nothing when the adapter onNotif gate is disabled", async () => {
    const central = vi
      .spyOn(systemNotif, "central")
      .mockResolvedValue(true);

    await tradeNotif.executed({
      context: createContext(() => false),
      decision: ENTRY_DECISION as never,
      mode: "live",
      position: createPosition(),
    });
    await tradeNotif.failed({
      context: createContext(() => false),
      decision: ENTRY_DECISION as never,
      error: new Error("boom"),
      mode: "live",
    });

    expect(central).not.toHaveBeenCalled();
  });
});
