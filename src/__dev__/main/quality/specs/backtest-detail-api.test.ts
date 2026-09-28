import type { NextApiRequest, NextApiResponse } from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isEnabled: vi.fn(() => true),
  readField: vi.fn(async () => null as unknown),
}));

vi.mock("@/lib/system/config", () => ({
  default: {
    devBacktest: { isEnabled: mocks.isEnabled },
  },
}));

vi.mock("@/lib/dev/backtestPrecision/api/cache", () => ({
  default: {
    readField: mocks.readField,
  },
}));

import handler from "@/lib/dev/backtestPrecision/api/detail";

const VALID_KEY = "a".repeat(64);

const makeReq = (query: Record<string, string>) =>
  ({ method: "GET", query }) as unknown as NextApiRequest;

const makeRes = () => {
  const json = vi.fn();
  const status = vi.fn(() => ({ end: vi.fn(), json }));
  return {
    json,
    res: {
      json,
      setHeader: vi.fn(),
      status,
    } as unknown as NextApiResponse,
    status,
  };
};

// BTEST:RESULT_DETAIL_API — chunked run artifacts load lazily per field so
// the POST response stays small and sections fetch data on expand.
describe("backtest detail API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isEnabled.mockReturnValue(true);
  });

  it("404s when the dev backtest is disabled", async () => {
    mocks.isEnabled.mockReturnValue(false);
    const { res, status, json } = makeRes();
    await handler(
      makeReq({ field: "positions", key: VALID_KEY }),
      res,
    );
    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({ error: "Not found" });
    expect(mocks.readField).not.toHaveBeenCalled();
  });

  it("rejects an invalid cache key", async () => {
    const { res, status } = makeRes();
    await handler(makeReq({ field: "positions", key: "../etc" }), res);
    expect(status).toHaveBeenCalledWith(400);
    expect(mocks.readField).not.toHaveBeenCalled();
  });

  it("rejects an unknown field", async () => {
    const { res, status } = makeRes();
    await handler(makeReq({ field: "everything", key: VALID_KEY }), res);
    expect(status).toHaveBeenCalledWith(400);
    expect(mocks.readField).not.toHaveBeenCalled();
  });

  it("serves positions with offset/limit slicing", async () => {
    mocks.readField.mockResolvedValue([{ p: 1 }, { p: 2 }, { p: 3 }, { p: 4 }]);
    const { res, status, json } = makeRes();
    await handler(
      makeReq({ field: "positions", key: VALID_KEY, limit: "2", offset: "1" }),
      res,
    );
    expect(mocks.readField).toHaveBeenCalledWith(VALID_KEY, "positions", undefined);
    expect(status).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith({
      limit: 2,
      offset: 1,
      positions: [{ p: 2 }, { p: 3 }],
      total: 4,
    });
  });

  it("serves one symbol's vPoints when name is given", async () => {
    mocks.readField.mockResolvedValue([{ id: "v1" }]);
    const { res, json } = makeRes();
    await handler(
      makeReq({ field: "vpoints", key: VALID_KEY, name: "AAA" }),
      res,
    );
    expect(mocks.readField).toHaveBeenCalledWith(VALID_KEY, "vpoints", "AAA");
    expect(json).toHaveBeenCalledWith({
      symbol: "AAA",
      vPoints: [{ id: "v1" }],
    });
  });

  it("serves all balance snapshots when no slug is given", async () => {
    mocks.readField.mockResolvedValue({ main: [{ t: 1 }] });
    const { res, json } = makeRes();
    await handler(makeReq({ field: "snapshots", key: VALID_KEY }), res);
    expect(json).toHaveBeenCalledWith({ balanceSnapshots: { main: [{ t: 1 }] } });
  });

  it("404s when the artifact is missing", async () => {
    mocks.readField.mockResolvedValue(null);
    const { res, status, json } = makeRes();
    await handler(makeReq({ field: "positions", key: VALID_KEY }), res);
    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      error: "Artifact not found for this cache key.",
    });
  });
});
