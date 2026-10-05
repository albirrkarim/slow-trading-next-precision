import type { NextApiRequest, NextApiResponse } from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendError: vi.fn(async () => undefined),
  buildRealtime: vi.fn(async () => ({ ok: true })),
  ensure: vi.fn(),
  purgeAccount: vi.fn(async () => undefined),
  resetSandbox: vi.fn(async () => undefined),
  resetSandboxAccount: vi.fn(async () => undefined),
}));

vi.mock("@/lib/production", () => ({
  default: {
    runtime: {
      get: () => ({ resetSandboxAccount: mocks.resetSandboxAccount }),
    },
  },
}));

vi.mock("@/lib/system/dashboard", () => ({
  systemDashboard: { state: { buildRealtime: mocks.buildRealtime } },
}));

vi.mock("@/lib/system/storage", () => ({
  runtimeLogs: { appendError: mocks.appendError },
  runtimeStorage: {
    catalog: {
      account: { resetSandbox: mocks.resetSandbox },
      ensure: mocks.ensure,
    },
    strategy: { purgeAccount: mocks.purgeAccount },
  },
}));

import handler from "@/pages/api/system/reset";

describe("system reset API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensure.mockResolvedValue({
      config: { accounts: [{ slug: "main", sandbox: { initialBalanceUSDT: 500 } }] },
    });
  });

  it("purges the account's strategy slice and live engine state after the file reset", async () => {
    // PROD:SANDBOX_ACCOUNT_RESET
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const req = {
      body: { account: "main" },
      method: "POST",
    } as unknown as NextApiRequest;
    const res = { status } as unknown as NextApiResponse;

    await handler(req, res);

    expect(mocks.resetSandbox).toHaveBeenCalledWith({
      account: "main",
      initialBalanceUSDT: undefined,
    });
    expect(mocks.purgeAccount).toHaveBeenCalledWith("sandbox", "main");
    expect(mocks.resetSandboxAccount).toHaveBeenCalledWith("main");
    expect(mocks.resetSandbox.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.purgeAccount.mock.invocationCallOrder[0],
    );
    expect(mocks.purgeAccount.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.resetSandboxAccount.mock.invocationCallOrder[0],
    );
    expect(status).toHaveBeenCalledWith(200);
  });
});
