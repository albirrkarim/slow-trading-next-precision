import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  RuntimeContext,
  RuntimeEntryDecision,
  RuntimePairEntryDecision,
} from "@/lib/precision/types";

const mocks = vi.hoisted(() => ({
  executeDecision: vi.fn(
    async (_context: unknown, _decision: unknown) => [{}],
  ),
  plan: vi.fn(),
}));

vi.mock("@/lib/precision/monitoring/entry", () => ({
  default: {
    capture: vi.fn(async () => undefined),
    executeDecision: mocks.executeDecision,
  },
}));
vi.mock("@/lib/precision/monitoring/position", () => ({
  default: { monitor: vi.fn(async () => undefined) },
}));
vi.mock("@/lib/precision/monitoring/stages", () => ({
  default: {
    standard: vi.fn(async () => undefined),
    speedup: vi.fn(async () => undefined),
  },
}));
vi.mock("@/lib/system/trading/entry-action", () => ({
  default: { plan: mocks.plan },
}));

import manual from "@/lib/precision/monitoring/manual";
import both from "@/lib/strategies/both";

function context({
  entryLegs = "BOTH",
  openDirection = "BOTH",
}: {
  entryLegs?: string;
  openDirection?: string;
} = {}): RuntimeContext {
  const account = {
    enabled: true,
    slug: "acc",
    trading: { entryLegs },
  };
  return {
    adapter: { clock: { now: () => 100 } },
    helper: {
      getAccount: () => account,
      market: {
        updateMarkPrice: async () => undefined,
        updateVPointsMap: async () => undefined,
      },
    },
    state: {
      config: {
        accounts: [account],
        management: {
          openDirection,
          symbols: ["SUI"],
          tradingMode: "futures",
        },
      },
      openPositions: [],
      vPointsMap: {
        SUI: [{ id: "vp-1", l: "T", lvl: 3, p: 1, t: 100 }],
      },
    },
    strategy: both,
  } as unknown as RuntimeContext;
}

function fundablePlan(spendableUsdt = 1000) {
  return {
    fundingPlan: {
      estimatedFeeUsdt: 1,
      estimatedMarginUsdt: 100,
      reserveBudgetUsdt: 0,
      spendableUsdt,
    },
  };
}

describe("manual forced entry — pair strategy shaping", () => {
  beforeEach(() => {
    mocks.executeDecision.mockClear();
    mocks.plan.mockReset();
    mocks.plan.mockReturnValue(fundablePlan());
  });

  it("reshapes a forced entry into an atomic MAIN + COUNTER pair", async () => {
    const result = await manual.run(context(), {
      disableEntry: true,
      forceEntries: [{ accountSlug: "acc", symbols: ["SUI"] }],
    });

    expect(mocks.executeDecision).toHaveBeenCalledOnce();
    const candidate = mocks.executeDecision.mock.calls[0][1] as RuntimePairEntryDecision;
    expect(candidate.type).toBe("pairEntry");
    expect(candidate.manual).toBe(true);
    expect(candidate.strategy).toEqual({
      entryLegs: "BOTH",
      pairId: "acc:SUI:vp-1",
    });
    expect(candidate.legs).toHaveLength(2);

    // Signal is a TOP → SHORT; MAIN follows it, COUNTER opposes it, and
    // each leg carries the manual flag plus its role marker.
    const [main, counter] = candidate.legs;
    expect(main.direction).toBe("SHORT");
    expect(main.manual).toBe(true);
    expect(main.strategy).toEqual({
      entryLegs: "BOTH",
      pairId: "acc:SUI:vp-1",
      role: "MAIN",
    });
    expect(main.vPointUsage).toEqual(["acc:MAIN"]);
    expect(counter.direction).toBe("LONG");
    expect(counter.manual).toBe(true);
    expect(counter.strategy).toEqual({
      entryLegs: "BOTH",
      pairId: "acc:SUI:vp-1",
      role: "COUNTER",
    });
    expect(counter.vPointUsage).toEqual(["acc:COUNTER"]);

    expect(result.entries[0].executed).toBe(true);
  });

  it("emits a single role leg when the account's entryLegs is MAIN", async () => {
    await manual.run(context({ entryLegs: "MAIN" }), {
      disableEntry: true,
      forceEntries: [{ accountSlug: "acc", symbols: ["SUI"] }],
    });

    const candidate = mocks.executeDecision.mock.calls[0][1] as RuntimeEntryDecision;
    expect(candidate.type).toBe("entry");
    expect(candidate.direction).toBe("SHORT");
    expect(candidate.manual).toBe(true);
    expect(candidate.strategy).toEqual({
      entryLegs: "MAIN",
      pairId: "acc:SUI:vp-1",
      role: "MAIN",
    });
    expect(candidate.vPointUsage).toEqual(["acc:MAIN"]);
  });

  it("keeps the plain manual decision under ONE_WAY", async () => {
    await manual.run(context({ openDirection: "ONE_WAY" }), {
      disableEntry: true,
      forceEntries: [{ accountSlug: "acc", symbols: ["SUI"] }],
    });

    const candidate = mocks.executeDecision.mock.calls[0][1] as RuntimeEntryDecision;
    expect(candidate.type).toBe("entry");
    expect(candidate.direction).toBe("SHORT");
    expect(candidate.manual).toBe(true);
    expect(candidate.strategy).toBeUndefined();
  });

  it("skips with a reason when the pair cannot be funded", async () => {
    mocks.plan.mockReturnValue(fundablePlan(50));

    const result = await manual.run(context(), {
      disableEntry: true,
      forceEntries: [{ accountSlug: "acc", symbols: ["SUI"] }],
    });

    expect(mocks.executeDecision).not.toHaveBeenCalled();
    expect(result.entries[0].executed).toBe(false);
    expect(result.entries[0].message).toContain("Pair entry skipped");
  });
});
