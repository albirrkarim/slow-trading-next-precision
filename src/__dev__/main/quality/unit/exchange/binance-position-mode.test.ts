import positionMode from "@/lib/exchange/platform/binance/futures/position-mode";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestPrivate: vi.fn(),
}));

vi.mock("@/lib/exchange/platform/binance/utils", () => ({
  requestPrivate: mocks.requestPrivate,
}));

describe("Binance futures position mode API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    [true, "HEDGE"],
    [false, "ONE_WAY"],
  ] as const)("maps dualSidePosition=%s to %s", async (value, expected) => {
    mocks.requestPrivate.mockResolvedValue({ dualSidePosition: value });

    await expect(positionMode.get()).resolves.toBe(expected);
    expect(mocks.requestPrivate).toHaveBeenCalledWith(
      "/fapi/v1/positionSide/dual",
      {},
      "get",
      "https://fapi.binance.com",
    );
  });

  it.each([
    ["HEDGE", true],
    ["ONE_WAY", false],
  ] as const)("changes %s with dualSidePosition=%s", async (mode, value) => {
    mocks.requestPrivate.mockResolvedValue({ code: 200, msg: "success" });

    await expect(positionMode.change(mode)).resolves.toBe(mode);
    expect(mocks.requestPrivate).toHaveBeenCalledWith(
      "/fapi/v1/positionSide/dual",
      { dualSidePosition: value },
      "post",
      "https://fapi.binance.com",
    );
  });
});
