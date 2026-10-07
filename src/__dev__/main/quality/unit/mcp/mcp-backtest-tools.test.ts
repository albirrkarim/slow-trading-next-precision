import { afterEach, describe, expect, it, vi } from "vitest";

import runtimeMcpTools from "@/lib/system/mcp/tools";
import type { RuntimeMcpAuthenticatedToken } from "@/lib/system/mcp/types";
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

describe("MCP backtest tool gating", () => {
  afterEach(() => {
    runtimeMcpTools.resetHandlers();
  });

  it("lists devOnly tools for permitted tokens and hides them without permission", () => {
    const reader = authWith(["backtest.read"]);
    const names = runtimeMcpTools.list(reader).map((tool) => tool.name);
    expect(names).toContain("backtest_run_status");
    expect(names).toContain("backtest_result_metrics");
    // Feature-gate experiment tools ride the same backtest.read + devOnly gate.
    expect(names).toContain("feature_gate_list");
    expect(names).toContain("feature_gate_datasets");
    expect(names).toContain("feature_gate_rows");
    expect(names).toContain("feature_gate_evaluate");
    // Write-permission tools stay hidden from a read-only token.
    expect(names).not.toContain("backtest_precision_run");
    expect(names).not.toContain("backtest_leaderboard_save");

    const stranger = authWith(["balance.read"]);
    expect(
      runtimeMcpTools.list(stranger).some((tool) =>
        tool.name.startsWith("backtest_"),
      ),
    ).toBe(false);
  });

  it("warns instead of dispatching when dev tooling is disabled", async () => {
    const handler = vi.fn();
    runtimeMcpTools.registerHandler("backtest_runs_list", handler);

    const result = await runtimeMcpTools.call({
      arguments: {},
      auth: authWith(["backtest.read"]),
      devToolsEnabled: false,
      name: "backtest_runs_list",
    });

    expect(handler).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({ warning: expect.stringContaining("local") }),
    );
  });

  it("keeps feature_gate tools behind the same dev-only gate", async () => {
    const handler = vi.fn().mockReturnValue({ gates: [] });
    runtimeMcpTools.registerHandler("feature_gate_list", handler);

    const blocked = await runtimeMcpTools.call({
      arguments: {},
      auth: authWith(["backtest.read"]),
      devToolsEnabled: false,
      name: "feature_gate_list",
    });
    expect(handler).not.toHaveBeenCalled();
    expect(blocked).toEqual(
      expect.objectContaining({ warning: expect.stringContaining("local") }),
    );

    const allowed = await runtimeMcpTools.call({
      arguments: {},
      auth: authWith(["backtest.read"]),
      devToolsEnabled: true,
      name: "feature_gate_list",
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(allowed).toEqual({ gates: [] });
  });

  it("dispatches to the registered handler when dev tooling is enabled", async () => {
    const handler = vi.fn().mockReturnValue({ runs: [], total: 0 });
    runtimeMcpTools.registerHandler("backtest_runs_list", handler);

    const result = await runtimeMcpTools.call({
      arguments: {},
      auth: authWith(["backtest.read"]),
      devToolsEnabled: true,
      name: "backtest_runs_list",
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ runs: [], total: 0 });
  });

  it("enforces permission before the dev gate", async () => {
    await expect(
      runtimeMcpTools.call({
        arguments: {},
        auth: authWith(["balance.read"]),
        devToolsEnabled: false,
        name: "backtest_runs_list",
      }),
    ).rejects.toThrow("permission");
  });

  it("keeps non-dev tools reachable without the dev flag", async () => {
    // balance_read is not devOnly — an external handler still gets invoked.
    const handler = vi.fn().mockReturnValue({ ok: true });
    runtimeMcpTools.registerHandler("balance_read", handler);

    const result = await runtimeMcpTools.call({
      arguments: {},
      auth: authWith(["balance.read"]),
      devToolsEnabled: false,
      name: "balance_read",
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true });
  });
});
