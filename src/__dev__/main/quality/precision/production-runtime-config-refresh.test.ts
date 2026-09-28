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

describe("ProductionRuntime.refreshConfig", () => {
  function seedState(): RuntimeEngineState {
    return {
      config: {
        accounts: [
          {
            slug: "main",
            credentials: { apiKey: "live-key" },
            enabled: true,
            name: "Main",
            sandbox: { initialBalanceUSDT: 100 },
            trading: { minEntryAbsLevel: 1 },
          },
        ],
        management: {
          exchangeType: "binance",
          strategy: "streak",
          symbols: ["SUI"],
          tradingMode: "futures",
        },
        runtime: {
          autoEntryEnabled: true,
          runnerEnabled: false,
        },
      },
    } as unknown as RuntimeEngineState;
  }

  it("hot-syncs runtime controls, symbols, and account trading while pinning construction-bound fields", async () => {
    // PROD:CONFIG_SAVE_RUNTIME_REFRESH
    const state = seedState();
    const runtime = new ProductionRuntime();
    const internals = runtime as unknown as {
      runPromise?: Promise<void>;
      state?: RuntimeEngineState;
    };
    internals.state = state;
    internals.runPromise = Promise.resolve();
    const runManual = vi
      .spyOn(runtime, "runManual")
      .mockImplementation(async (task) => task({ state } as RuntimeContext));
    vi.spyOn(runtimeStorage.catalog, "load").mockResolvedValue({
      config: {
        accounts: [
          {
            slug: "main",
            credentials: { apiKey: "rotated-key" },
            enabled: false,
            name: "Renamed",
            sandbox: { initialBalanceUSDT: 900 },
            trading: { minEntryAbsLevel: 0 },
          },
        ],
        management: {
          blackSwan: { enabled: true },
          exchangeType: "bybit",
          strategy: "both",
          symbols: ["SUI", "LINK"],
          tradingMode: "spot",
        },
        runtime: {
          autoEntryEnabled: false,
          runnerEnabled: true,
        },
      },
    } as never);

    await runtime.refreshConfig();

    expect(runManual).toHaveBeenCalledOnce();
    // Per-pass runtime controls swap wholesale.
    expect(state.config.runtime.runnerEnabled).toBe(true);
    expect(state.config.runtime.autoEntryEnabled).toBe(false);
    // Management syncs per-pass fields but keeps construction-bound values.
    expect(state.config.management.symbols).toEqual(["SUI", "LINK"]);
    expect(state.config.management.blackSwan).toEqual({ enabled: true });
    expect(state.config.management.strategy).toBe("streak");
    expect(state.config.management.tradingMode).toBe("futures");
    expect(state.config.management.exchangeType).toBe("binance");
    // Account: live readers refresh; adapter-bound fields stay.
    const account = state.config.accounts[0];
    expect(account.trading.minEntryAbsLevel).toBe(0);
    expect(account.enabled).toBe(false);
    expect(account.name).toBe("Renamed");
    expect(account.credentials.apiKey).toBe("live-key");
    expect(account.sandbox.initialBalanceUSDT).toBe(100);
  });

  it("mutates the retained state directly and restarts when the runner turns on while stopped", async () => {
    // PROD:CONFIG_SAVE_RUNTIME_REFRESH
    const state = seedState();
    const runtime = new ProductionRuntime();
    const internals = runtime as unknown as {
      factory?: unknown;
      state?: RuntimeEngineState;
    };
    internals.state = state;
    internals.factory = {};
    const runManual = vi.spyOn(runtime, "runManual");
    const start = vi
      .spyOn(runtime, "start")
      .mockResolvedValue(undefined);
    vi.spyOn(runtimeStorage.catalog, "load").mockResolvedValue({
      config: {
        accounts: [],
        management: { symbols: [] },
        runtime: { runnerEnabled: true },
      },
    } as never);

    await runtime.refreshConfig();

    // No run is live — the retained state is mutated without runManual.
    expect(runManual).not.toHaveBeenCalled();
    expect(state.config.runtime.runnerEnabled).toBe(true);
    expect(start).toHaveBeenCalledOnce();
  });

  it("does nothing before a state exists", async () => {
    const runtime = new ProductionRuntime();
    const runManual = vi.spyOn(runtime, "runManual");

    await runtime.refreshConfig();

    expect(runManual).not.toHaveBeenCalled();
  });
});
