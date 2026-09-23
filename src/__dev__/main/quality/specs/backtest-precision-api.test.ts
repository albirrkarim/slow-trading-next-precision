import type { NextApiRequest, NextApiResponse } from "next";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isEnabled: vi.fn(() => true),
  precisionBacktest: vi.fn(async () => ({
    balanceSnapshots: [],
    exchangeType: "binance",
    positions: [],
    vPointsMap: {},
  })),
}));

vi.mock("@/lib/system/config", () => ({
  default: { devBacktest: { isEnabled: mocks.isEnabled } },
}));

vi.mock("@/lib/dev/backtestPrecision/backtest", () => ({
  precisionBacktest: mocks.precisionBacktest,
}));

import handler from "@/lib/dev/backtestPrecision/api/run";

let tmpRoot: string | null = null;
let previousRoot: string | undefined;

function makeRequest(body: Record<string, unknown>) {
  const json = vi.fn();
  const res = {
    json,
    setHeader: vi.fn(),
    status: vi.fn(() => ({ json })),
  } as unknown as NextApiResponse;
  const req = { body, method: "POST" } as unknown as NextApiRequest;
  return { json, req, res };
}

const BODY = {
  config: {
    accounts: [{ enabled: true, slug: "main" }],
    management: { symbols: ["BTC"] },
  },
  range: "1year",
};

describe("backtest precision API result cache", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    previousRoot = process.env.PERSISTENT_STORAGE_ROOT;
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "backtest-api-"));
    process.env.PERSISTENT_STORAGE_ROOT = tmpRoot;
  });

  afterEach(async () => {
    if (tmpRoot) {
      await fs.remove(tmpRoot);
      tmpRoot = null;
    }
    if (previousRoot === undefined) {
      delete process.env.PERSISTENT_STORAGE_ROOT;
    } else {
      process.env.PERSISTENT_STORAGE_ROOT = previousRoot;
    }
  });

  it("serves the second identical run from the saved result", async () => {
    const first = makeRequest(BODY);
    await handler(first.req, first.res);
    expect(mocks.precisionBacktest).toHaveBeenCalledTimes(1);

    const second = makeRequest(BODY);
    await handler(second.req, second.res);
    expect(mocks.precisionBacktest).toHaveBeenCalledTimes(1);
    expect(second.json).toHaveBeenCalledWith(
      expect.objectContaining({ exchangeType: "binance" }),
    );
  });

  it("recomputes when either freshness flag is set", async () => {
    const first = makeRequest(BODY);
    await handler(first.req, first.res);
    expect(mocks.precisionBacktest).toHaveBeenCalledTimes(1);

    const rerun = makeRequest({ ...BODY, upToDateDecisionBacktest: true });
    await handler(rerun.req, rerun.res);
    expect(mocks.precisionBacktest).toHaveBeenCalledTimes(2);

    const freshKlines = makeRequest({ ...BODY, upToDateKlines: true });
    await handler(freshKlines.req, freshKlines.res);
    expect(mocks.precisionBacktest).toHaveBeenCalledTimes(3);
  });

  it("does not reuse a result saved under a different range", async () => {
    const first = makeRequest(BODY);
    await handler(first.req, first.res);

    const second = makeRequest({ ...BODY, range: "6month" });
    await handler(second.req, second.res);
    expect(mocks.precisionBacktest).toHaveBeenCalledTimes(2);
  });
});
