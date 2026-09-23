import type { NextApiRequest, NextApiResponse } from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendError: vi.fn(async () => undefined),
  ensure: vi.fn(async () => ({
    config: {
      accounts: [
        { enabled: true, slug: "main" },
        { enabled: false, slug: "paused" },
        { enabled: true, slug: "second" },
      ],
    },
    mode: "live" as const,
  })),
  readCombined: vi.fn(async () => []),
}));

vi.mock("@/lib/system/storage", () => ({
  runtimeBalanceSnapshots: {
    readCombined: mocks.readCombined,
  },
  runtimeLogs: {
    appendError: mocks.appendError,
  },
  runtimeStorage: {
    catalog: {
      ensure: mocks.ensure,
    },
  },
}));

import handler from "@/pages/api/slow-trading/balance-snapshots";

describe("balance snapshots API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("aggregates balance snapshots for enabled accounts only", async () => {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const req = {
      method: "GET",
      query: { mode: "live" },
    } as unknown as NextApiRequest;
    const res = { status } as unknown as NextApiResponse;

    await handler(req, res);

    // PROD:MULTI_ACCOUNT_DAILY_BALANCE_SNAPSHOTS
    expect(mocks.readCombined).toHaveBeenCalledWith({
      accounts: ["main", "second"],
      mode: "live",
    });
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith([]);
  });
});
