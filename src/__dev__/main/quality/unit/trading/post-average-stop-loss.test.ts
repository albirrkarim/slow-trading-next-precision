import { describe, expect, it } from "vitest";

import { createTestPosition } from "../fixtures/position";
import postAverageStopLoss from "@/lib/system/trading/post-average-stop-loss";
import type { VolatilityPoint } from "@/lib/system/types";

const BASE = Date.UTC(2026, 5, 18);

function vPoint(overrides: Partial<VolatilityPoint> = {}): VolatilityPoint {
  return {
    id: "B_TEST",
    l: "B",
    lvl: -4,
    p: 100,
    pct: 5,
    t: BASE,
    vb: 1,
    vq: 1,
    ...overrides,
  };
}

function positionWithExecutions(
  executions: Array<{
    level: number;
    price: number;
    t: number;
  }>,
  direction: "LONG" | "SHORT" = "LONG",
) {
  return createTestPosition({
    averaging: {
      entryLevel: -2,
      lastHandledLevel: executions.at(-1)?.level ?? -2,
      reserveBaseMarginUsdt: 10,
      reservedRemainingMarginUsdt: 0,
      steps: [],
      executions: executions.map((execution) => ({
        allocationPct: 2,
        marginUsdt: 10,
        ...execution,
      })),
    },
    direction,
  });
}

const CONFIG = {
  enabled: true,
  thresholds: [
    {
      adverseDriftPct: 5,
      maxNetPnlPct: 0,
      maxNetPnlUsdt: 0,
      minAveragingCount: 1,
    },
  ],
};

describe("post-average stop loss", () => {
  // BOTH:POST_AVERAGE_STOP_LOSS — adverseDriftPct is an independent boundary
  // measured from the vPoint latest at the last completed averaging fill.

  it("exits on adverse drift from the last averaging vPoint even when pnl boundaries are disabled", () => {
    const position = positionWithExecutions([
      { level: -4, price: 99, t: BASE + 1_000 },
    ]);
    const result = postAverageStopLoss.evaluate({
      config: CONFIG,
      currentPrice: 94,
      direction: "LONG",
      netPnlPercent: -0.5,
      netPnlUsdt: -1,
      position,
      volatilityPoints: [vPoint({ lvl: -4, p: 100, t: BASE })],
    });

    expect(result.anchorPrice).toBe(100);
    expect(result.adverseDriftPct).toBeCloseTo(6);
    expect(result.hitDrift).toBe(true);
    expect(result.shouldExit).toBe(true);
  });

  it("stays quiet when the adverse drift is below the boundary", () => {
    const position = positionWithExecutions([
      { level: -4, price: 99, t: BASE + 1_000 },
    ]);
    const result = postAverageStopLoss.evaluate({
      config: CONFIG,
      currentPrice: 96,
      direction: "LONG",
      netPnlPercent: -0.5,
      netPnlUsdt: -1,
      position,
      volatilityPoints: [vPoint({ lvl: -4, p: 100, t: BASE })],
    });

    expect(result.adverseDriftPct).toBeCloseTo(4);
    expect(result.hitDrift).toBe(false);
    expect(result.shouldExit).toBe(false);
  });

  it("anchors on the latest completed averaging, not an earlier one", () => {
    const position = positionWithExecutions([
      { level: -4, price: 99, t: BASE + 1_000 },
      { level: -5, price: 95, t: BASE + 3_000 },
    ]);
    const result = postAverageStopLoss.evaluate({
      config: { enabled: true, thresholds: [{ ...CONFIG.thresholds[0], minAveragingCount: 1 }] },
      currentPrice: 94,
      direction: "LONG",
      netPnlPercent: -0.5,
      netPnlUsdt: -1,
      position,
      volatilityPoints: [
        vPoint({ id: "B_1", lvl: -4, p: 100, t: BASE }),
        vPoint({ id: "B_2", lvl: -5, p: 96, t: BASE + 2_000 }),
      ],
    });

    expect(result.anchorPrice).toBe(96);
    expect(result.adverseDriftPct).toBeCloseTo((2 / 96) * 100);
    expect(result.hitDrift).toBe(false);
    expect(result.shouldExit).toBe(false);
  });

  it("falls back to the averaging fill price when its vPoint aged out", () => {
    const position = positionWithExecutions([
      { level: -4, price: 100, t: BASE + 1_000 },
    ]);
    const result = postAverageStopLoss.evaluate({
      config: CONFIG,
      currentPrice: 94,
      direction: "LONG",
      netPnlPercent: -0.5,
      netPnlUsdt: -1,
      position,
      volatilityPoints: [vPoint({ p: 200, t: BASE + 5_000 })],
    });

    expect(result.anchorPrice).toBe(100);
    expect(result.hitDrift).toBe(true);
    expect(result.shouldExit).toBe(true);
  });

  it("measures adverse drift upward for SHORT positions", () => {
    const position = positionWithExecutions(
      [{ level: 4, price: 101, t: BASE + 1_000 }],
      "SHORT",
    );
    const result = postAverageStopLoss.evaluate({
      config: CONFIG,
      currentPrice: 106,
      direction: "SHORT",
      netPnlPercent: -0.5,
      netPnlUsdt: -1,
      position,
      volatilityPoints: [vPoint({ l: "T", lvl: 4, p: 100, t: BASE })],
    });

    expect(result.adverseDriftPct).toBeCloseTo(6);
    expect(result.hitDrift).toBe(true);
    expect(result.shouldExit).toBe(true);
  });

  it("keeps the drift boundary inactive at zero and preserves OR semantics with pnl boundaries", () => {
    const position = positionWithExecutions([
      { level: -4, price: 99, t: BASE + 1_000 },
    ]);
    const result = postAverageStopLoss.evaluate({
      config: {
        enabled: true,
        thresholds: [
          {
            adverseDriftPct: 0,
            maxNetPnlPct: -2,
            maxNetPnlUsdt: 0,
            minAveragingCount: 1,
          },
        ],
      },
      currentPrice: 50,
      direction: "LONG",
      netPnlPercent: -3,
      netPnlUsdt: -1,
      position,
      volatilityPoints: [vPoint({ lvl: -4, p: 100, t: BASE })],
    });

    expect(result.hitDrift).toBe(false);
    expect(result.hitPercent).toBe(true);
    expect(result.shouldExit).toBe(true);
  });

  it("normalizes adverseDriftPct to a non-negative boundary", () => {
    const normalized = postAverageStopLoss.config.normalize({
      enabled: true,
      thresholds: [
        {
          adverseDriftPct: -3,
          maxNetPnlPct: -2,
          maxNetPnlUsdt: 0,
          minAveragingCount: 1,
        },
      ],
    });

    expect(normalized.thresholds[0].adverseDriftPct).toBe(0);
  });
});
