import type { NextApiRequest, NextApiResponse } from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendConfig: vi.fn(async () => undefined),
  appendError: vi.fn(async () => undefined),
  deleteState: vi.fn(async () => undefined),
  diffConfig: vi.fn(() => []),
  ensure: vi.fn(),
  refreshAccountTrading: vi.fn(async () => undefined),
  save: vi.fn(),
}));

vi.mock("@/lib/production", () => ({
  default: {
    runtime: { get: () => ({ refreshAccountTrading: mocks.refreshAccountTrading }) },
  },
}));

vi.mock("@/lib/system/storage", () => ({
  runtimeLogs: {
    appendConfig: mocks.appendConfig,
    appendError: mocks.appendError,
  },
  runtimeStorage: {
    catalog: {
      account: { deleteState: mocks.deleteState },
      accounts: { save: mocks.save },
      diffConfig: mocks.diffConfig,
      ensure: mocks.ensure,
    },
  },
}));

import handler from "@/pages/api/system/account/index";

describe("account trading save API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensure.mockResolvedValue({
      config: { accounts: [{ slug: "main" }] },
    });
    mocks.save.mockResolvedValue([
      { slug: "main", trading: { minEntryAbsLevel: 0 } },
    ]);
  });

  it("refreshes the active engine after persisting an account's zero entry minimum", async () => {
    // PROD:ACCOUNT_TRADING_SAVE_RUNTIME_REFRESH
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const req = {
      body: { accounts: [{ slug: "main", trading: { minEntryAbsLevel: 0 } }] },
      method: "PUT",
    } as unknown as NextApiRequest;
    const res = { status } as unknown as NextApiResponse;

    await handler(req, res);

    expect(mocks.save).toHaveBeenCalledWith(req.body.accounts);
    expect(mocks.refreshAccountTrading).toHaveBeenCalledOnce();
    expect(mocks.save.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.refreshAccountTrading.mock.invocationCallOrder[0],
    );
    expect(status).toHaveBeenCalledWith(200);
  });
});
