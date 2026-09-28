import { afterEach, describe, expect, it, vi } from "vitest";

import type { RuntimeContext, RuntimeEngineState } from "@/lib/precision/types";
import { ProductionRuntime } from "@/lib/production/runtime";
import type { RuntimeAccountConfig } from "@/lib/system/runtime";
import { runtimeStorage } from "@/lib/system/storage";
import tradingEntry from "@/lib/system/trading/entry";

afterEach(() => vi.restoreAllMocks());

describe("ProductionRuntime.refreshAccountTrading", () => {
  it("applies a saved zero entry minimum to the active state without changing other accounts", async () => {
    // PROD:ACCOUNT_TRADING_SAVE_RUNTIME_REFRESH
    const main = {
      slug: "main",
      trading: { minEntryAbsLevel: 1, maxEntryAbsLevel: 3 },
    } as RuntimeAccountConfig;
    const second = {
      slug: "second",
      trading: { minEntryAbsLevel: 2 },
    } as RuntimeAccountConfig;
    const state = {
      config: { accounts: [main, second] },
    } as RuntimeEngineState;
    const runtime = new ProductionRuntime();
    const runManual = vi.spyOn(runtime, "runManual").mockImplementation(async (task) =>
      task({ state } as RuntimeContext),
    );
    vi.spyOn(runtimeStorage.catalog.accounts, "list").mockResolvedValue([
      {
        ...main,
        trading: {
          ...main.trading,
          minEntryAbsLevel: 0,
          maxEntryAbsLevel: 0,
        },
      },
    ]);

    await runtime.refreshAccountTrading();

    expect(runManual).toHaveBeenCalledOnce();
    expect(main.trading).toMatchObject({
      minEntryAbsLevel: 0,
      maxEntryAbsLevel: 0,
    });
    expect(tradingEntry.threshold.contains(0, main.trading.minEntryAbsLevel)).toBe(
      true,
    );
    expect(second.trading.minEntryAbsLevel).toBe(2);
  });

  it("removes a cleared entry bound from the active state", async () => {
    // PROD:ACCOUNT_TRADING_SAVE_RUNTIME_REFRESH
    const account = {
      slug: "main",
      trading: { minEntryAbsLevel: 1 },
    } as RuntimeAccountConfig;
    const state = {
      config: { accounts: [account] },
    } as RuntimeEngineState;
    const runtime = new ProductionRuntime();
    vi.spyOn(runtime, "runManual").mockImplementation(async (task) =>
      task({ state } as RuntimeContext),
    );
    vi.spyOn(runtimeStorage.catalog.accounts, "list").mockResolvedValue([
      { ...account, trading: {} as RuntimeAccountConfig["trading"] },
    ]);

    await runtime.refreshAccountTrading();

    expect(account.trading.minEntryAbsLevel).toBeUndefined();
  });
});
