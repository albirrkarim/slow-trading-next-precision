import { afterEach, describe, expect, it, vi } from "vitest";

import type { RuntimeContext, RuntimeEngineState } from "@/lib/precision/types";
import { ProductionRuntime } from "@/lib/production/runtime";
import { runtimeStorage } from "@/lib/system/storage";
import type { Position } from "@/lib/system/trading";

afterEach(() => vi.restoreAllMocks());

function sandboxPosition(account: string, symbol: string): Position {
  return { account, symbol } as Position;
}

function seedState(): RuntimeEngineState {
  return {
    balance: {
      "1": {
        available: 40,
        locked: 95,
        reserved: 0,
        safeHaven: 0,
        spendable: 40,
        startingBalance: 135,
        total: 135,
      },
      "2": {
        available: 200,
        locked: 10,
        reserved: 0,
        safeHaven: 0,
        spendable: 200,
        startingBalance: 210,
        total: 210,
      },
    },
    mode: "sandbox",
    openPositions: [
      sandboxPosition("1", "SUI"),
      sandboxPosition("1", "LINK"),
      sandboxPosition("2", "BTC"),
    ],
    strategy: {
      v: "streak",
      roles: {
        "1:SUI:B_a": { accountSlug: "1", pairId: "1:SUI:B_a" },
        "2:BTC:B_b": { accountSlug: "2", pairId: "2:BTC:B_b" },
      },
    },
  } as unknown as RuntimeEngineState;
}

describe("ProductionRuntime.resetSandboxAccount", () => {
  // PROD:SANDBOX_ACCOUNT_RESET
  it("purges the account's positions, balance summary, and strategy records from sandbox state", async () => {
    const state = seedState();
    const runtime = new ProductionRuntime();
    (runtime as unknown as { state: RuntimeEngineState }).state = state;
    const runManual = vi
      .spyOn(runtime, "runManual")
      .mockImplementation(async (task) => task({ state } as RuntimeContext));
    vi.spyOn(runtimeStorage.account, "load").mockResolvedValue({
      positions: [],
      balance: { startingBalanceUSDT: 500, quoteAsset: 500 },
    });

    await runtime.resetSandboxAccount("1");

    expect(runManual).toHaveBeenCalledOnce();
    expect(state.openPositions).toEqual([sandboxPosition("2", "BTC")]);
    expect(state.balance["1"]).toEqual({
      available: 500,
      locked: 0,
      reserved: 0,
      safeHaven: 0,
      spendable: 500,
      startingBalance: 500,
      total: 500,
    });
    expect(state.balance["2"].total).toBe(210);
    expect(state.strategy).toEqual({
      v: "streak",
      roles: { "2:BTC:B_b": { accountSlug: "2", pairId: "2:BTC:B_b" } },
    });
  });

  it("does nothing when the engine holds a live-mode state", async () => {
    const state = { ...seedState(), mode: "live" as const };
    const runtime = new ProductionRuntime();
    (runtime as unknown as { state: RuntimeEngineState }).state = state;
    vi.spyOn(runtime, "runManual").mockImplementation(async (task) =>
      task({ state } as RuntimeContext),
    );
    const load = vi.spyOn(runtimeStorage.account, "load");

    await runtime.resetSandboxAccount("1");

    expect(state.openPositions).toHaveLength(3);
    expect((state.strategy as any).roles["1:SUI:B_a"]).toBeDefined();
    expect(load).not.toHaveBeenCalled();
  });

  it("skips the manual pass entirely when no state was ever loaded", async () => {
    const runtime = new ProductionRuntime();
    const runManual = vi.spyOn(runtime, "runManual");

    await runtime.resetSandboxAccount("1");

    expect(runManual).not.toHaveBeenCalled();
  });
});
