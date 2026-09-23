import type { NextApiRequest, NextApiResponse } from "next";
import type { VolatilityPoint } from "@/lib/system/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const STORED_POINT: VolatilityPoint = {
  id: "T_abc_01_01_25_00_00",
  l: "T",
  lvl: 1,
  p: 1,
  pct: 1,
  t: 0,
  vb: 0,
  vq: 0,
};

const mocks = vi.hoisted(() => ({
  detectVPoints: vi.fn(() => [STORED_POINT]),
  downloadRange: vi.fn(async () => []),
  resolveRange: vi.fn(() => ({ endTime: 1, startTime: 0 })),
  vpointsRead: vi.fn(async () => [STORED_POINT]),
}));

vi.mock("@/lib/system/utils/klines", () => ({
  default: {
    downloadRange: mocks.downloadRange,
    resolveRange: mocks.resolveRange,
  },
}));

vi.mock("@/lib/system/utils/vpoints", () => ({
  default: { detectVPoints: mocks.detectVPoints },
}));

vi.mock("@/lib/system/storage", () => ({
  runtimeStorage: {
    vpoints: { read: mocks.vpointsRead },
  },
}));

import { getKlines } from "@/pages/api/market/klines";

function makeRequest(query: Record<string, unknown>) {
  const json = vi.fn();
  const res = {
    json,
    setHeader: vi.fn(),
    status: vi.fn(() => ({ json })),
  } as unknown as NextApiResponse;
  const req = { method: "GET", query } as unknown as NextApiRequest;
  return { json, req, res };
}

const QUERY = {
  exchange: "binance",
  interval: "5m",
  marketType: "FUTURES",
  symbol: "BTC",
};

describe("market klines API volatility flag", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("treats the string 'false' as disabled", async () => {
    const { json, req, res } = makeRequest({
      ...QUERY,
      volatility: "false",
      volatilitySource: "storage",
    });

    await getKlines(req, res);

    expect(mocks.vpointsRead).not.toHaveBeenCalled();
    expect(mocks.detectVPoints).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        markers: [],
        vPointsSeries: { names: [], series: [] },
      }),
    );
  });

  it("loads stored vPoints when volatility is enabled", async () => {
    const { json, req, res } = makeRequest({
      ...QUERY,
      volatility: "true",
      volatilitySource: "storage",
    });

    await getKlines(req, res);

    expect(mocks.vpointsRead).toHaveBeenCalledTimes(1);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        markers: expect.arrayContaining([
          expect.objectContaining({ shape: "arrowDown" }),
        ]),
      }),
    );
    const body = json.mock.calls[0][0] as {
      vPointsSeries: { series: unknown[][] };
    };
    expect(body.vPointsSeries.series[0]).toHaveLength(1);
  });
});
