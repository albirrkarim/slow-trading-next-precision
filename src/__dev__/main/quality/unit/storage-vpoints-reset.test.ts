import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateAtomic: vi.fn(),
}));

vi.mock("@/lib/system/storage/json-file", () => ({
  default: {
    update: { atomic: mocks.updateAtomic },
  },
}));

import runtimeStorage from "@/lib/system/storage/runtime";

describe("runtimeStorage.vpoints.resetUsage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("strips every usage marker on the file's own contents", async () => {
    let written: any;
    mocks.updateAtomic.mockImplementation(async (_file: any, update: any) => {
      written = update({
        lastVolatility: [
          {
            id: "B_a",
            t: 1,
            usedBy: ["Main", "Second"],
            usedByMain: true,
          },
          { id: "T_b", t: 2, used: true },
          { id: "T_c", t: 3 },
        ],
        otherField: "keep",
      });
    });

    await runtimeStorage.vpoints.resetUsage({
      exchangeType: "binance",
      symbol: "link",
    });

    expect(mocks.updateAtomic).toHaveBeenCalledTimes(1);
    expect(written.symbol).toBe("LINK");
    expect(written.otherField).toBe("keep");
    expect(written.lastVolatility).toEqual([
      { id: "B_a", t: 1 },
      { id: "T_b", t: 2 },
      { id: "T_c", t: 3 },
    ]);
  });
});
