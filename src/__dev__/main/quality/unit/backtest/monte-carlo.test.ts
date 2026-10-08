import { describe, expect, it } from "vitest";

import monteCarlo, {
  type MonteCarloTrade,
} from "@/lib/dev/backtestPrecision/monte-carlo";
import type { Position } from "@/lib/system/trading";

const position = (
  account: string,
  t: number,
  netUsdt: number,
  closed = true,
): Position =>
  ({
    account,
    ...(closed ? { closed: { t } } : {}),
    pnl: { netUsdt },
  }) as Position;

const pool: MonteCarloTrade[] = [
  { account: "a", pnlUsdt: 10, t: 1 },
  { account: "a", pnlUsdt: -20, t: 2 },
  { account: "a", pnlUsdt: 5, t: 3 },
  { account: "a", pnlUsdt: -10, t: 4 },
  { account: "a", pnlUsdt: 30, t: 5 },
];

describe("monte-carlo trades extraction", () => {
  it("keeps closed positions in close order and filters by account", () => {
    const positions = [
      position("a", 5, 30),
      position("b", 2, -7),
      position("a", 1, 10),
      position("a", 9, -10, false), // open
    ];
    const all = monteCarlo.trades(positions);
    expect(all.map((row) => row.t)).toEqual([1, 2, 5]);
    const onlyA = monteCarlo.trades(positions, "a");
    expect(onlyA.map((row) => row.t)).toEqual([1, 5]);
  });
});

describe("monte-carlo replay", () => {
  it("computes drawdown, streak and ruin on a known sequence", () => {
    // 1000 → 1010 → 990 → 995 → 985 → 1015
    const stats = monteCarlo.replay(
      [10, -20, 5, -10, 30],
      1000,
      true,
    );
    expect(stats.maxDrawdownUsdt).toBe(25); // peak 1010 → trough 985
    expect(stats.finalEquityUsdt).toBe(1015);
    expect(stats.longestLosingStreak).toBe(1);
    expect(stats.ruined).toBe(false);
    expect(stats.curve).toEqual([1000, 1010, 990, 995, 985, 1015]);
  });

  it("flags ruin when equity hits zero", () => {
    const stats = monteCarlo.replay([5, -1000], 15, false);
    expect(stats.ruined).toBe(true);
  });
});

describe("monte-carlo simulate", () => {
  it("is reproducible under a fixed seed", () => {
    const params = {
      iterations: 200,
      method: "shuffle" as const,
      seed: 42,
      startBalanceUsdt: 1000,
      trades: pool,
    };
    const a = monteCarlo.simulate(params);
    const b = monteCarlo.simulate(params);
    expect(a.drawdownUsdt).toEqual(b.drawdownUsdt);
    expect(a.ruinRate).toBe(b.ruinRate);
  });

  it("aggregates quantiles and marks the realized path", () => {
    const result = monteCarlo.simulate({
      iterations: 400,
      method: "shuffle",
      seed: 7,
      startBalanceUsdt: 1000,
      trades: pool,
    });
    expect(result.iterations).toBe(400);
    expect(result.trades).toBe(pool.length);
    expect(result.drawdownUsdt.p5).toBeLessThanOrEqual(
      result.drawdownUsdt.p50,
    );
    expect(result.drawdownUsdt.p50).toBeLessThanOrEqual(
      result.drawdownUsdt.p95,
    );
    expect(result.drawdownUsdt.p95).toBeLessThanOrEqual(
      result.drawdownUsdt.max,
    );
    expect(result.actual.maxDrawdownUsdt).toBe(25);
    expect(result.actualDrawdownPercentile).toBeGreaterThanOrEqual(0);
    expect(result.actualDrawdownPercentile).toBeLessThanOrEqual(1);
    expect(result.bands).toHaveLength(pool.length + 1);
    expect(
      result.histogram.reduce((sum, bin) => sum + bin.count, 0),
    ).toBe(400);
  });

  it("block bootstrap with blockSize=n reproduces contiguous chunks", () => {
    const result = monteCarlo.simulate({
      blockSize: pool.length,
      iterations: 50,
      method: "block",
      seed: 3,
      startBalanceUsdt: 1000,
      trades: pool,
    });
    // A whole-pool block is the only possible draw, so every path equals the
    // realized sequence — zero spread between p5 and p95.
    expect(result.drawdownUsdt.p5).toBe(result.drawdownUsdt.max);
    expect(result.drawdownUsdt.max).toBe(25);
  });

  it("detects ruin under an undersized starting balance", () => {
    const result = monteCarlo.simulate({
      iterations: 100,
      method: "shuffle",
      seed: 1,
      startBalanceUsdt: 15, // a single -20 draw already bankrupts
      trades: pool,
    });
    expect(result.ruinRate).toBeGreaterThan(0);
  });
});
