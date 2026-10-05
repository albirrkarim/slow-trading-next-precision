import type { VolatilityPoint } from "@/lib/system/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureCatalog: vi.fn(),
  ensureDir: vi.fn(async () => undefined),
  exists: vi.fn(async (_target: unknown) => false),
  mergeVPoints: vi.fn(async (_args: unknown) => undefined),
  readJson: vi.fn(async () => ({})),
  readVPoints: vi.fn(),
  resetVPointsUsage: vi.fn(async (_args: unknown) => undefined),
  runManual: vi.fn(),
  writeJson: vi.fn(async () => undefined),
}));

vi.mock("@/lib/production", () => ({
  default: {
    runtime: {
      get: () => ({ runManual: mocks.runManual }),
    },
  },
}));

vi.mock("fs-extra", () => ({
  default: {
    ensureDir: mocks.ensureDir,
    exists: mocks.exists,
    readJson: mocks.readJson,
    writeJson: mocks.writeJson,
  },
}));

vi.mock("@/lib/system/storage", () => ({
  runtimeStorage: {
    catalog: { ensure: mocks.ensureCatalog },
    vpoints: {
      merge: mocks.mergeVPoints,
      read: mocks.readVPoints,
      resetUsage: mocks.resetVPointsUsage,
    },
  },
  storageFiles: {
    prod: {
      cache: { getCachePrefix: () => "/tmp/cache/volatility-" },
      volatility: () => "/tmp/volatility",
    },
  },
}));

import handler from "@/pages/api/market/volatility";

function storedPoint(id: string): VolatilityPoint {
  return {
    id,
    l: "B",
    lvl: -1,
    p: 12,
    pct: 4,
    t: 1,
    usedBy: ["Main"],
  } as unknown as VolatilityPoint;
}

function makeResponse() {
  const res = {
    end: vi.fn(),
    json: vi.fn(),
    setHeader: vi.fn(),
    status: vi.fn(),
  } as any;
  res.status.mockReturnValue(res);
  return res;
}

function makeRequest(body: Record<string, unknown>) {
  return { body, method: "POST", query: {} } as any;
}

describe("market volatility removeUsed reset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureCatalog.mockResolvedValue({
      config: {
        accounts: [],
        management: {
          exchangeType: "binance",
          symbols: ["LINK"],
          tradingMode: "futures",
        },
        runtime: {},
      },
      mode: "live",
    });
    mocks.exists.mockImplementation(async (target) =>
      String(target).startsWith("/tmp/volatility/"),
    );
    mocks.readVPoints.mockResolvedValue([storedPoint("B_a"), storedPoint("B_b")]);
  });

  it("clears in-memory markers before persisting the cleaned copies", async () => {
    const enginePoints = [
      { id: "B_a", usedBy: ["Main"], usedByMain: true },
      { id: "B_c", used: true },
    ];
    const state = { vPointsMap: { LINK: enginePoints } };
    mocks.runManual.mockImplementation(async (task: any) =>
      task({ state }),
    );
    const res = makeResponse();

    await handler(
      makeRequest({ removeUsed: true, symbols: ["LINK"] }),
      res,
    );

    expect(mocks.runManual).toHaveBeenCalledTimes(1);
    expect(enginePoints[0].usedBy).toBeUndefined();
    // Legacy `usedBy<slug>` keys are stripped alongside the new markers.
    expect(enginePoints[0].usedByMain).toBeUndefined();
    expect(enginePoints[1].used).toBeUndefined();
    // The in-memory reset must run before the file reset so later
    // state-change flushes cannot resurrect the markers.
    expect(mocks.runManual.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.resetVPointsUsage.mock.invocationCallOrder[0],
    );
    expect(mocks.resetVPointsUsage).toHaveBeenCalledWith({
      exchangeType: "binance",
      symbol: "LINK",
    });
    expect(mocks.mergeVPoints).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ status: true }),
    );
  });

  it("still resets persisted markers when the engine is unavailable", async () => {
    mocks.runManual.mockRejectedValue(new Error("runtime not ready"));
    const res = makeResponse();

    await handler(
      makeRequest({ removeUsed: true, symbols: ["LINK"] }),
      res,
    );

    expect(mocks.resetVPointsUsage).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ status: true }),
    );
  });
});
