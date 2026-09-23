import { describe, expect, it } from "vitest";

import runtimeDailyPnlLimit from "@/lib/system/trading/daily-pnl-limit";

const DAY_START = Date.UTC(2026, 5, 18);
const NOW = DAY_START + 12 * 60 * 60 * 1000;

function closedAt(t: number, netUsdt: number) {
  return { closed: { t }, opened: { t: t - 60_000 }, pnl: { netUsdt } };
}

describe("daily PnL entry stop", () => {
  // BOTH:AUTO_ENTRY_DAILY_PNL_LIMIT_USDT — the same evaluation gates
  // production entries (persisted history) and backtest entries (closed
  // position history accumulated by the adapter).
  it("reaches the stop when the day's closed net PnL is at or below the threshold", () => {
    const positions = [closedAt(NOW - 60_000, -30), closedAt(NOW - 30_000, -20)];

    expect(
      runtimeDailyPnlLimit.guard.evaluate({
        currentTimeMs: NOW,
        positions,
        thresholdUsdt: -50,
      }).reached,
    ).toBe(true);

    expect(
      runtimeDailyPnlLimit.guard.evaluate({
        currentTimeMs: NOW,
        positions: [closedAt(NOW - 60_000, -30)],
        thresholdUsdt: -50,
      }).reached,
    ).toBe(false);
  });

  it("lets winning and losing trades of the same day offset each other", () => {
    const positions = [
      closedAt(NOW - 120_000, 40),
      closedAt(NOW - 60_000, -80),
    ];

    const evaluation = runtimeDailyPnlLimit.guard.evaluate({
      currentTimeMs: NOW,
      positions,
      thresholdUsdt: -50,
    });

    expect(evaluation.pnlUsdt).toBe(-40);
    expect(evaluation.reached).toBe(false);
  });

  it("ignores trades closed on other UTC days and resets at the next day", () => {
    const yesterday = closedAt(DAY_START - 60_000, -100);

    expect(
      runtimeDailyPnlLimit.guard.evaluate({
        currentTimeMs: NOW,
        positions: [yesterday],
        thresholdUsdt: -50,
      }).reached,
    ).toBe(false);

    const nextDay = DAY_START + 24 * 60 * 60_000;
    expect(
      runtimeDailyPnlLimit.guard.evaluate({
        currentTimeMs: nextDay + 60_000,
        positions: [closedAt(nextDay + 30_000, -60)],
        thresholdUsdt: -50,
      }).reached,
    ).toBe(true);
  });

  it("falls back to opened time when a position has no close time", () => {
    const openedToday = {
      opened: { t: NOW - 60_000 },
      pnl: { netUsdt: -60 },
    };

    expect(
      runtimeDailyPnlLimit.guard.evaluate({
        currentTimeMs: NOW,
        positions: [openedToday],
        thresholdUsdt: -50,
      }).reached,
    ).toBe(true);
  });

  it("normalizes missing thresholds to the -50 default and clamps positives", () => {
    expect(
      runtimeDailyPnlLimit.guard.evaluate({
        currentTimeMs: NOW,
        positions: [closedAt(NOW - 60_000, -49)],
        thresholdUsdt: undefined,
      }).reached,
    ).toBe(false);

    expect(
      runtimeDailyPnlLimit.guard.evaluate({
        currentTimeMs: NOW,
        positions: [closedAt(NOW - 60_000, -60)],
        thresholdUsdt: undefined,
      }).reached,
    ).toBe(true);

    expect(
      runtimeDailyPnlLimit.guard.evaluate({
        currentTimeMs: NOW,
        positions: [closedAt(NOW - 60_000, -1)],
        thresholdUsdt: 10,
      }).reached,
    ).toBe(true);
  });
});
