import { describe, expect, it } from "vitest";

import backtestStats from "@/lib/dev/backtestPrecision/backtest/stats";
import type {
  BacktestBalanceSnapshot,
  BacktestPrecisionResult,
} from "@/lib/dev/backtestPrecision/backtest/backtest-precision-types";
import type { Position } from "@/lib/system/trading";
import type { VolatilityPoint } from "@/lib/system/types";

const closedPosition = (overrides: {
  account?: string;
  netUsdt?: number;
  reason?: string;
  symbol?: string;
}): Position =>
  ({
    account: overrides.account ?? "main",
    closed: { reason: overrides.reason ?? "", t: 1 },
    opened: { t: 0 },
    pnl: { netUsdt: overrides.netUsdt ?? 0 },
    symbol: overrides.symbol ?? "AAA_USDT",
  }) as unknown as Position;

const openPosition = (account = "main"): Position =>
  ({ account, opened: { t: 0 }, pnl: {} }) as unknown as Position;

const snapshot = (
  t: number,
  total: number,
  startingBalance = 0,
): BacktestBalanceSnapshot => ({
  available: total,
  locked: 0,
  reserved: 0,
  safeHaven: 0,
  spendable: total,
  startingBalance,
  t,
  total,
});

// BTEST:RESULT_RUN_SUMMARY — chunked runs carry precomputed aggregates so the
// dashboard summary renders without loading position arrays.
describe("backtest run stats", () => {
  it("accumulates exit histograms split by pnl sign per account", () => {
    const tracker = backtestStats.tracker.create();

    tracker.onExit(
      closedPosition({ netUsdt: 5, reason: "STOP_LOSS_PLUS_TP", symbol: "AAA_USDT" }),
    );
    tracker.onExit(closedPosition({ netUsdt: 1, reason: "RESCUE", symbol: "AAA_USDT" }));
    tracker.onExit(closedPosition({ account: "alt", netUsdt: -2, reason: "RESCUE", symbol: "BBB_USDT" }));
    tracker.onExit(closedPosition({ netUsdt: -1 }));

    const summary = tracker.summary();
    const counts = tracker.counts();

    expect(counts.closedPositions).toBe(4);
    expect(counts.positions).toBe(4);

    const main = summary.accounts;
    expect(main).toEqual([]); // no snapshots recorded yet
    expect(summary.exits.main).toEqual({
      loss: [{ count: 1, reason: "UNKNOWN" }],
      lossCoins: [{ count: 1, reason: "AAA" }],
      profit: [
        { count: 1, reason: "RESCUE" },
        { count: 1, reason: "STOP_LOSS_PLUS_TP" },
      ],
      profitCoins: [{ count: 2, reason: "AAA" }],
    });
    expect(summary.exits.alt.loss).toEqual([{ count: 1, reason: "RESCUE" }]);
    expect(summary.exits.alt.lossCoins).toEqual([{ count: 1, reason: "BBB" }]);
  });

  it("keeps BLACK_SWAN_EXIT distinct from FORCED in exit histograms", () => {
    const tracker = backtestStats.tracker.create();

    tracker.onExit(closedPosition({ netUsdt: -3, reason: "BLACK_SWAN_EXIT" }));
    tracker.onExit(closedPosition({ netUsdt: -1, reason: "FORCED" }));

    const summary = tracker.summary();
    expect(summary.exits.main.loss).toEqual([
      { count: 1, reason: "BLACK_SWAN_EXIT" },
      { count: 1, reason: "FORCED" },
    ]);
  });

  it("builds account rows from first/last snapshots with win-loss tallies", () => {
    const tracker = backtestStats.tracker.create();

    tracker.onSnapshot("main", snapshot(1000, 100, 100));
    tracker.onSnapshot("main", snapshot(2000, 150, 100));
    tracker.onSnapshot("alt", snapshot(2000, 50));
    tracker.onExit(closedPosition({ account: "main", netUsdt: 3 }));
    tracker.onExit(closedPosition({ account: "main", netUsdt: -1 }));

    const summary = tracker.summary();
    expect(summary.accounts).toEqual([
      {
        slug: "main",
        start: 100,
        end: 150,
        pnlUsdt: 50,
        gainPct: 50,
        wins: 1,
        losses: 1,
      },
      // startingBalance 0 falls back to first total; gainPct needs start > 0
      { slug: "alt", start: 50, end: 50, pnlUsdt: 0, gainPct: 0, wins: 0, losses: 0 },
    ]);
    expect(tracker.counts().snapshots).toBe(3);
  });

  it("does not double-count a repeated snapshot timestamp", () => {
    const tracker = backtestStats.tracker.create();
    tracker.onSnapshot("main", snapshot(1000, 100));
    tracker.onSnapshot("main", snapshot(1000, 110));
    tracker.onSnapshot("main", snapshot(2000, 120));
    expect(tracker.counts().snapshots).toBe(2);
    expect(tracker.summary().accounts[0]).toMatchObject({ end: 120 });
  });

  it("summarize() derives identical aggregates from a materialized result", () => {
    const result: BacktestPrecisionResult = {
      balanceSnapshots: {
        main: [snapshot(1000, 100, 100), snapshot(2000, 140, 100)],
      },
      exchangeType: "binance",
      positions: [
        closedPosition({ netUsdt: 4, reason: "TP" }),
        closedPosition({ netUsdt: -1 }),
        openPosition(),
      ],
      vPointsMap: { AAA: [{ id: "a" } as VolatilityPoint, { id: "b" } as VolatilityPoint] },
    };

    const { counts, summary } = backtestStats.summarize(result);
    expect(counts).toEqual({
      closedPositions: 2,
      positions: 3,
      snapshots: 2,
      vPoints: 2,
    });
    expect(summary.accounts[0]).toMatchObject({
      slug: "main",
      start: 100,
      end: 140,
      wins: 1,
      losses: 1,
    });
    expect(summary.exits.main.profit).toEqual([{ count: 1, reason: "TP" }]);
    expect(summary.exits.main.loss).toEqual([{ count: 1, reason: "UNKNOWN" }]);
  });
});
