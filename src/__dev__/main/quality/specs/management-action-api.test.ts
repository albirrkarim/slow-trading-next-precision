import type { NextApiRequest, NextApiResponse } from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendConfig: vi.fn(async () => undefined),
  appendError: vi.fn(async () => undefined),
  appendManagement: vi.fn(async () => undefined),
  build: vi.fn(() => [
    {
      action: "add",
      reason: "Configured Symbols list was updated through the dashboard storage API.",
      source: "dashboard.coin-management",
      symbol: "IOTX",
    },
  ]),
  buildCombined: vi.fn(async () => ({ activeMode: "live" })),
  diffConfig: vi.fn(() => []),
  ensure: vi.fn(),
  notify: vi.fn(async () => undefined),
  runnerGet: vi.fn(async () => undefined),
  update: vi.fn(),
}));

vi.mock("@/lib/production", () => ({
  default: {
    runtime: { get: mocks.runnerGet },
  },
}));

vi.mock("@/lib/system/dashboard", () => ({
  default: {
    state: { buildCombined: mocks.buildCombined },
  },
}));

vi.mock("@/lib/system/notification/management", () => ({
  default: {
    build: mocks.build,
    notify: mocks.notify,
  },
}));

vi.mock("@/lib/system/storage", () => ({
  runtimeLogs: {
    appendConfig: mocks.appendConfig,
    appendError: mocks.appendError,
    appendManagement: mocks.appendManagement,
  },
  runtimeStorage: {
    catalog: {
      diffConfig: mocks.diffConfig,
      ensure: mocks.ensure,
      update: mocks.update,
    },
  },
}));

import handler from "@/pages/api/system/state";

describe("storage API management-action notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensure.mockResolvedValue({
      config: { management: { symbols: ["AAVE"] } },
      mode: "live",
    });
    mocks.update.mockResolvedValue({
      config: {
        management: { symbols: ["AAVE", "IOTX"] },
        runtime: { notification: { email: {}, telegram: {} } },
      },
      mode: "live",
    });
  });

  it("notifies additions and removals with the dashboard source", async () => {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const req = {
      body: { symbols: ["AAVE", "IOTX"] },
      method: "PUT",
    } as unknown as NextApiRequest;
    const res = { status } as unknown as NextApiResponse;

    await handler(req, res);

    expect(mocks.build).toHaveBeenCalledWith({
      previousSymbols: ["AAVE"],
      nextSymbols: ["AAVE", "IOTX"],
      reason:
        "Configured Symbols list was updated through the dashboard storage API.",
      source: "dashboard.coin-management",
    });
    expect(mocks.notify).toHaveBeenCalledWith({
      actions: expect.arrayContaining([
        expect.objectContaining({ action: "add", symbol: "IOTX" }),
      ]),
      notification: { email: {}, telegram: {} },
    });
    expect(mocks.appendManagement).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "add",
        reason:
          "Configured Symbols list was updated through the dashboard storage API.",
        source: "dashboard.coin-management",
        symbol: "IOTX",
      }),
    );
    expect(status).toHaveBeenCalledWith(200);
  });
});
