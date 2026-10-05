import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/dev/backtestPrecision/api/runner", () => ({
  default: {
    activeRun: vi.fn(),
    start: vi.fn(),
  },
}));

vi.mock("@/lib/dev/backtestPrecision/api/cache", () => ({
  default: {
    dirFor: () => "/tmp/btest-cache",
    key: () => "a".repeat(64),
    readMeta: vi.fn(async () => null),
  },
}));

import backtestRunner from "@/lib/dev/backtestPrecision/api/runner";
import backtestMcp from "@/lib/dev/backtestPrecision/mcp";
import runtimeMcpTools from "@/lib/system/mcp/tools";
import type { RuntimeMcpAuthenticatedToken } from "@/lib/system/mcp/types";
import type { BacktestChunkedResult } from "@/lib/dev/backtestPrecision/backtest/backtest-precision-types";
import type {
  RuntimeMcpPermission,
  RuntimeMcpTokenRecord,
} from "@/lib/system/runtime/types";

function authWith(
  permissions: RuntimeMcpPermission[],
): RuntimeMcpAuthenticatedToken {
  const token: RuntimeMcpTokenRecord = {
    createdAt: 1,
    enabled: true,
    id: "tok",
    name: "test",
    permissions,
    tokenHash: "hash",
    tokenSecretEncrypted: "enc",
  };
  return { permissions: new Set(permissions), token };
}

const runCall = () =>
  runtimeMcpTools.call({
    arguments: {
      config: { accounts: [{ enabled: true }] },
      range: "1month",
    },
    auth: authWith(["backtest.run"]),
    devToolsEnabled: true,
    name: "backtest_precision_run",
  });

describe("backtest_precision_run slot", () => {
  afterEach(() => {
    runtimeMcpTools.resetHandlers();
    vi.mocked(backtestRunner.activeRun).mockReset();
    vi.mocked(backtestRunner.start).mockReset();
  });

  it("reports busy without starting when another run holds the slot", async () => {
    const occupyingKey = "b".repeat(64);
    vi.mocked(backtestRunner.activeRun).mockReturnValue({
      cacheKey: occupyingKey,
      startedAt: 123,
    });
    backtestMcp.register();

    const result = await runCall();

    expect(backtestRunner.start).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        running: { cacheKey: occupyingKey, startedAt: 123 },
        status: "busy",
      }),
    );
  });

  it("joins an identical in-flight run instead of reporting busy", async () => {
    const sameKey = "a".repeat(64);
    vi.mocked(backtestRunner.activeRun).mockReturnValue({
      cacheKey: sameKey,
      startedAt: 1,
    });
    vi.mocked(backtestRunner.start).mockReturnValue({
      alreadyRunning: true,
      cacheKey: sameKey,
      cachePath: "/tmp/btest-cache",
      result: Promise.resolve({} as BacktestChunkedResult),
    });
    backtestMcp.register();

    const result = await runCall();

    expect(backtestRunner.start).toHaveBeenCalledTimes(1);
    expect(result).toEqual(
      expect.objectContaining({
        alreadyRunning: true,
        cacheKey: sameKey,
        status: "running",
      }),
    );
  });
});
