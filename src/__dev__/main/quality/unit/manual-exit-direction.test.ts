import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeContext } from "@/lib/precision/types";
import type { Position } from "@/lib/system/trading";

const mocks = vi.hoisted(() => ({
  monitor: vi.fn(
    async (_context: unknown, _position: unknown) => undefined,
  ),
}));

vi.mock("@/lib/precision/monitoring/position", () => ({
  default: { monitor: mocks.monitor },
}));
vi.mock("@/lib/precision/monitoring/stages", () => ({
  default: {
    standard: vi.fn(async () => undefined),
    speedup: vi.fn(async () => undefined),
  },
}));
vi.mock("@/lib/precision/monitoring/entry", () => ({
  default: {
    capture: vi.fn(async () => undefined),
    executeDecision: vi.fn(async () => []),
  },
}));

import manual from "@/lib/precision/monitoring/manual";

function position(direction: "LONG" | "SHORT"): Position {
  return {
    account: "acc",
    direction,
    opened: { t: 1 },
    symbol: "SUI",
  } as unknown as Position;
}

function context(): RuntimeContext {
  return {
    adapter: { clock: { now: () => 100 } },
    helper: {
      market: {
        updateMarkPrice: async () => undefined,
        updateVPointsMap: async () => undefined,
      },
    },
    state: {
      config: {
        accounts: [{ enabled: true, slug: "acc", trading: {} }],
        management: { symbols: ["SUI"], tradingMode: "futures" },
        runtime: {},
      },
      openPositions: [position("LONG"), position("SHORT")],
      vPointsMap: {},
    },
  } as unknown as RuntimeContext;
}

describe("manual exit — direction filter", () => {
  beforeEach(() => mocks.monitor.mockClear());

  it("closes only the requested leg direction of a hedge pair", async () => {
    const ctx = context();
    const result = await manual.run(ctx, {
      disableEntry: true,
      forceExits: [
        { accountSlug: "acc", direction: "SHORT", symbols: ["SUI"] },
      ],
    });

    expect(mocks.monitor).toHaveBeenCalledOnce();
    const monitored = mocks.monitor.mock.calls[0][1] as Position;
    expect(monitored.direction).toBe("SHORT");
    expect(monitored.control?.forceExit).toBeDefined();
    expect(result.exits).toHaveLength(1);

    // The LONG sibling leg is untouched.
    expect(ctx.state.openPositions[0].direction).toBe("LONG");
    expect(ctx.state.openPositions[0].control?.forceExit).toBeUndefined();
  });

  it("keeps the legacy behavior when direction is omitted", async () => {
    const ctx = context();
    await manual.run(ctx, {
      disableEntry: true,
      forceExits: [{ accountSlug: "acc", symbols: ["SUI"] }],
    });

    expect(mocks.monitor).toHaveBeenCalledTimes(2);
    for (const pos of ctx.state.openPositions) {
      expect(pos.control?.forceExit).toBeDefined();
    }
  });
});
