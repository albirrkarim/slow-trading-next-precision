import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeContext } from "@/lib/precision/types";

const mocks = vi.hoisted(() => ({
  executeDecision: vi.fn(async () => ({})),
}));

vi.mock("@/lib/precision/monitoring/entry", () => ({
  default: {
    capture: vi.fn(async () => undefined),
    executeDecision: mocks.executeDecision,
  },
}));
vi.mock("@/lib/precision/monitoring/stages", () => ({
  default: {
    standard: vi.fn(async () => undefined),
    speedup: vi.fn(async () => undefined),
  },
}));

import manual from "@/lib/precision/monitoring/manual";

function context(level: number, min?: number, max?: number): RuntimeContext {
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
        accounts: [{
          enabled: true,
          slug: "account",
          trading: { minEntryAbsLevel: min, maxEntryAbsLevel: max },
        }],
        management: { tradingMode: "futures" },
      },
      openPositions: [],
      vPointsMap: {
        SUI: [{ id: "point", l: "T", lvl: level, p: 1, t: 100 }],
      },
    },
  } as unknown as RuntimeContext;
}

describe("manual entry level bounds", () => {
  beforeEach(() => mocks.executeDecision.mockClear());

  it("accepts level zero when the maximum is zero and the minimum is disabled", async () => {
    // BOTH:DECISION_V20_LEVEL_GATE
    const result = await manual.run(context(0, undefined, 0), {
      disableEntry: true,
      forceEntries: [{ accountSlug: "account", symbols: ["SUI"] }],
    });

    expect(result.entries[0].executed).toBe(true);
    expect(mocks.executeDecision).toHaveBeenCalledOnce();
  });

  it("blocks levels above zero unless the operator bypasses the gate", async () => {
    const blocked = await manual.run(context(1, undefined, 0), {
      disableEntry: true,
      forceEntries: [{ accountSlug: "account", symbols: ["SUI"] }],
    });
    expect(blocked.entries[0].message).toContain("above maximum 0");
    expect(mocks.executeDecision).not.toHaveBeenCalled();

    const bypassed = await manual.run(context(1, undefined, 0), {
      bypass: true,
      disableEntry: true,
      forceEntries: [{ accountSlug: "account", symbols: ["SUI"] }],
    });
    expect(bypassed.entries[0].executed).toBe(true);
  });
});
