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

describe("runtimeStorage.strategy.purgeAccountRecords", () => {
  // PROD:SANDBOX_ACCOUNT_RESET
  it("drops records keyed by or tagged with the account slug only", () => {
    const slice = {
      v: "streak",
      roles: {
        "1:SUI:B_a": { accountSlug: "1", pairId: "1:SUI:B_a" },
        "2:LINK:B_b": { accountSlug: "2", pairId: "2:LINK:B_b" },
      },
      closed: {
        "1:SUI:B_c": { accountSlug: "1" },
        "2:SUI:B_d": {},
      },
      pendingClose: {
        "1:BTC:B_e": { message: "cascade" },
        "2:BTC:B_f": { message: "keep" },
      },
    };

    const next = runtimeStorage.strategy.purgeAccountRecords(slice, "1");

    expect(next).toBe(slice);
    expect(slice.v).toBe("streak");
    expect(slice.roles).toEqual({
      "2:LINK:B_b": { accountSlug: "2", pairId: "2:LINK:B_b" },
    });
    expect(slice.closed).toEqual({ "2:SUI:B_d": {} });
    expect(slice.pendingClose).toEqual({ "2:BTC:B_f": { message: "keep" } });
  });

  it("returns non-record input untouched", () => {
    expect(
      runtimeStorage.strategy.purgeAccountRecords(undefined, "1"),
    ).toBeUndefined();
    expect(
      runtimeStorage.strategy.purgeAccountRecords("stale", "1"),
    ).toBe("stale");
  });
});

describe("runtimeStorage.strategy.purgeAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("strips the account's records from the mode slice and preserves the sibling mode", async () => {
    let written: any;
    mocks.updateAtomic.mockImplementation(async (_file: any, update: any) => {
      written = update({
        live: { v: "streak", roles: { "1:SUI:B_a": { accountSlug: "1" } } },
        sandbox: {
          v: "streak",
          roles: {
            "1:SUI:B_a": { accountSlug: "1" },
            "2:LINK:B_b": { accountSlug: "2" },
          },
        },
      });
    });

    await runtimeStorage.strategy.purgeAccount("sandbox", "1");

    expect(mocks.updateAtomic).toHaveBeenCalledTimes(1);
    expect(written.sandbox).toEqual({
      v: "streak",
      roles: { "2:LINK:B_b": { accountSlug: "2" } },
    });
    expect(written.live).toEqual({
      v: "streak",
      roles: { "1:SUI:B_a": { accountSlug: "1" } },
    });
  });

  it("leaves the file untouched when the mode has no slice", async () => {
    let written: any;
    mocks.updateAtomic.mockImplementation(async (_file: any, update: any) => {
      written = update({ live: { v: "both", closed: {} } });
    });

    await runtimeStorage.strategy.purgeAccount("sandbox", "1");

    expect(written).toEqual({ live: { v: "both", closed: {} } });
  });
});
