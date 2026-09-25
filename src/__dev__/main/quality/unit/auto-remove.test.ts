import { beforeEach, describe, expect, it, vi } from "vitest";

const MINUTE_MS = 60_000;
const NOW = Date.UTC(2026, 8, 3, 10, 5);

const mocks = vi.hoisted(() => ({
  appendManagement: vi.fn(async () => ({})),
  catalogLoad: vi.fn(async () => undefined as any),
  catalogUpdate: vi.fn(async (input: any) => input),
  getMarketCapUSDMapForSymbols: vi.fn(
    async () => ({}) as Record<string, number>,
  ),
  managementNotify: vi.fn(async () => undefined),
  vpointsRead: vi.fn(async (_params?: any) => [] as any[]),
}));

vi.mock("@/lib/system/logging", () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  systemLog: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock("@/lib/system/storage", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/system/storage")>();
  return {
    ...actual,
    runtimeLogs: {
      ...actual.runtimeLogs,
      appendManagement: mocks.appendManagement,
    },
    runtimeStorage: {
      ...actual.runtimeStorage,
      catalog: {
        ...actual.runtimeStorage.catalog,
        load: mocks.catalogLoad,
        update: mocks.catalogUpdate,
      },
      vpoints: {
        ...actual.runtimeStorage.vpoints,
        read: mocks.vpointsRead,
      },
    },
  };
});

vi.mock("@/lib/system/notification/management", () => ({
  default: {
    build: vi.fn(() => []),
    notify: mocks.managementNotify,
  },
}));

vi.mock("@/lib/exchange/market-cap", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/exchange/market-cap")>();
  return {
    ...actual,
    getMarketCapUSDMapForSymbols: mocks.getMarketCapUSDMapForSymbols,
  };
});

import type { RuntimeContext } from "@/lib/precision/types";
import coinManagement from "@/lib/production/coin-management";
import autoRemove from "@/lib/system/trading/auto-remove";
import entry from "@/lib/system/trading/entry";
import entryAction from "@/lib/system/trading/entry-action";
import type { VolatilityPoint } from "@/lib/system/types";

function vpoint(overrides: Partial<VolatilityPoint> = {}): VolatilityPoint {
  return {
    id: `p_${overrides.lvl ?? -3}`,
    l: "B",
    lvl: -3,
    p: 1,
    pct: 4,
    t: NOW - MINUTE_MS,
    vb: 0,
    vq: 0,
    ...overrides,
  } as VolatilityPoint;
}

function kline(openTime: number, close: number) {
  return [
    openTime,
    String(close),
    String(close),
    String(close),
    String(close),
    "1",
    openTime + 5 * MINUTE_MS - 1,
  ] as never;
}

function catalog(overrides: {
  runtime?: Record<string, unknown>;
  symbols?: string[];
} = {}) {
  return {
    config: {
      accounts: [],
      management: {
        exchangeType: "binance",
        symbols: overrides.symbols ?? ["SUI", "ADA"],
        tradingMode: "spot",
      },
      runtime: {
        autoRemoveSymbolAbsLevel: 0,
        autoRemoveSymbolMinMarketCapUSD: 0,
        autoRemoveSymbolMinPrice: 0,
        autoRemoveSymbolMinVPointPct: 0,
        notification: {
          telegram: {
            enabled: true,
            types: [{ id: "NOTIF_MANAGEMENT_ACTION" }],
          },
        },
        runnerEnabled: true,
        ...overrides.runtime,
      },
    },
    mode: "sandbox",
  } as any;
}

function contextWith(config: any): RuntimeContext {
  return {
    adapter: {},
    helper: {},
    state: {
      config: structuredClone(config),
      currentTime: NOW,
      mode: "sandbox",
      openPositions: [],
    },
  } as unknown as RuntimeContext;
}

describe("autoRemove helpers", () => {
  it("finds symbols whose latest persisted vPoint reached the absolute level", () => {
    // PROD:AUTO_REMOVE_COIN_ABOVE_SOME_ABS_LEVEL
    const volatilityPointsBySymbol = {
      ADA: [vpoint({ lvl: -2 })],
      SUI: [vpoint({ lvl: -3 }), vpoint({ id: "latest", lvl: 7 })],
    };
    expect(
      autoRemove.find.byAbsLevel({
        configuredSymbols: ["sui", "ADA"],
        thresholdAbsLevel: 6,
        volatilityPointsBySymbol,
      }),
    ).toEqual(["SUI"]);
    // Equality qualifies; a disabled threshold never removes.
    expect(
      autoRemove.find.byAbsLevel({
        configuredSymbols: ["SUI"],
        thresholdAbsLevel: 7,
        volatilityPointsBySymbol,
      }),
    ).toEqual(["SUI"]);
    expect(
      autoRemove.find.byAbsLevel({
        configuredSymbols: ["SUI", "ADA"],
        thresholdAbsLevel: 0,
        volatilityPointsBySymbol,
      }),
    ).toEqual([]);
    // Missing volatility data never proves a removal.
    expect(
      autoRemove.find.byAbsLevel({
        configuredSymbols: ["SUI", "ADA", "DOGE"],
        thresholdAbsLevel: 6,
        volatilityPointsBySymbol: {},
      }),
    ).toEqual([]);
  });

  it("finds symbols strictly below the minimum price", () => {
    // PROD:AUTO_REMOVE_COIN_BELOW_MIN_PRICE
    expect(
      autoRemove.find.byMinPrice({
        configuredSymbols: ["SUI", "ADA", "DOGE"],
        latestPriceBySymbol: { ADA: 3, SUI: 1.5 },
        minimumPrice: 2,
      }),
    ).toEqual(["SUI"]);
    // Equal prices stay eligible; missing data never removes.
    expect(
      autoRemove.find.byMinPrice({
        configuredSymbols: ["SUI", "ADA", "DOGE"],
        latestPriceBySymbol: { SUI: 2 },
        minimumPrice: 2,
      }),
    ).toEqual([]);
  });

  it("finds symbols strictly below the minimum market cap", () => {
    // PROD:AUTO_REMOVE_COIN_BELOW_MIN_MARKET_CAP
    expect(
      autoRemove.find.byMarketCap({
        configuredSymbols: ["SUI", "ADA", "DOGE"],
        marketCapUSDBySymbol: { ADA: 200, DOGE: Number.NaN, SUI: 50 },
        minimumMarketCapUSD: 100,
      }),
    ).toEqual(["SUI"]);
    expect(
      autoRemove.find.byMarketCap({
        configuredSymbols: ["SUI"],
        marketCapUSDBySymbol: { SUI: 100 },
        minimumMarketCapUSD: 100,
      }),
    ).toEqual([]);
  });

  it("finds symbols when any stored vPoint meets the percent threshold", () => {
    // PROD:AUTO_REMOVE_COIN_BY_VPOINT_PCT — every stored point counts, not
    // only the latest runtime point.
    expect(
      autoRemove.find.byVPointPct({
        configuredSymbols: ["SUI", "ADA"],
        minimumVPointPct: 15,
        volatilityPointsBySymbol: {
          ADA: [vpoint({ pct: 3 })],
          SUI: [vpoint({ id: "old", pct: 16 }), vpoint({ pct: 5 })],
        },
      }),
    ).toEqual(["SUI"]);
    // Equality qualifies; invalid and missing points never remove.
    expect(
      autoRemove.find.byVPointPct({
        configuredSymbols: ["SUI"],
        minimumVPointPct: 16,
        volatilityPointsBySymbol: {
          SUI: [vpoint({ pct: 16 }), vpoint({ pct: Number.NaN })],
        },
      }),
    ).toEqual(["SUI"]);
    expect(
      autoRemove.find.byVPointPct({
        configuredSymbols: ["DOGE"],
        minimumVPointPct: 15,
        volatilityPointsBySymbol: {},
      }),
    ).toEqual([]);
  });

  it("evaluates the minimum-price predicate edge cases", () => {
    const isBelowMinimum = autoRemove.price.isBelowMinimum;
    expect(isBelowMinimum({ minimumPrice: 2, price: 1.9 })).toBe(true);
    expect(isBelowMinimum({ minimumPrice: 2, price: 2 })).toBe(false);
    expect(isBelowMinimum({ minimumPrice: 0, price: 0.5 })).toBe(false);
    expect(isBelowMinimum({ minimumPrice: 2, price: Number.NaN })).toBe(false);
    expect(isBelowMinimum({ minimumPrice: 2, price: undefined })).toBe(false);
  });

  it("removes symbols from a configured list preserving order", () => {
    expect(
      autoRemove.remove.fromConfig(
        ["ADA", "SUI", "DOGE"],
        ["sui", "UNKNOWN"],
      ),
    ).toEqual(["ADA", "DOGE"]);
  });

  it("returns the stored vPoint with the highest valid pct", () => {
    const highest = autoRemove.vPoint.findHighestPct([
      vpoint({ id: "a", pct: 3 }),
      vpoint({ id: "b", pct: Number.NaN }),
      vpoint({ id: "c", pct: 9 }),
      vpoint({ id: "d", pct: 7 }),
    ]);
    expect(highest?.id).toBe("c");
    expect(autoRemove.vPoint.findHighestPct([])).toBeUndefined();
  });
});

describe("coinManagement.run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getMarketCapUSDMapForSymbols.mockResolvedValue({});
    mocks.vpointsRead.mockResolvedValue([]);
  });

  function runWith(
    config: any,
    context: RuntimeContext,
    getKlines: any = vi.fn(async () => []),
  ) {
    return coinManagement.run({
      getKlines,
      now: () => NOW,
      runExclusive: (task) => task(context),
    });
  }

  it("skips evaluation while the runner is disabled", async () => {
    // PROD:AUTO_REMOVE_* passes never run for a stopped runner.
    mocks.catalogLoad.mockResolvedValue(
      catalog({ runtime: { runnerEnabled: false } }),
    );
    const result = await runWith(
      catalog({ runtime: { runnerEnabled: false } }).config,
      contextWith(catalog().config),
    );
    expect(result.skipped).toBe(true);
    expect(mocks.vpointsRead).not.toHaveBeenCalled();
    expect(mocks.catalogUpdate).not.toHaveBeenCalled();
  });

  it("skips when every auto-remove threshold is disabled", async () => {
    mocks.catalogLoad.mockResolvedValue(catalog());
    const result = await runWith(
      catalog().config,
      contextWith(catalog().config),
    );
    expect(result.skipped).toBe(true);
    expect(mocks.catalogUpdate).not.toHaveBeenCalled();
  });

  it("removes a coin whose latest persisted vPoint reached the level", async () => {
    // PROD:AUTO_REMOVE_COIN_ABOVE_SOME_ABS_LEVEL
    const config = catalog({ runtime: { autoRemoveSymbolAbsLevel: 6 } }).config;
    mocks.catalogLoad.mockResolvedValue(catalog({
      runtime: { autoRemoveSymbolAbsLevel: 6 },
    }));
    mocks.vpointsRead.mockImplementation(async ({ symbol }: any) =>
      symbol === "SUI"
        ? [vpoint({ lvl: -2 }), vpoint({ id: "top", lvl: 7 })]
        : [vpoint({ lvl: -1 })],
    );

    const context = contextWith(config);
    const result = await runWith(config, context);

    expect(result.removedSymbols).toEqual(["SUI"]);
    expect(mocks.catalogUpdate).toHaveBeenCalledWith({
      symbols: ["ADA"],
    });
    // The running engine's in-memory config follows the committed list.
    expect(context.state.config.management.symbols).toEqual(["ADA"]);
    expect(mocks.appendManagement).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "remove",
        source:
          "slow-trading.sandbox-cycle.coin-management:auto-remove-abs-level",
        symbol: "SUI",
      }),
    );
    expect(mocks.managementNotify).toHaveBeenCalledTimes(1);
    expect(mocks.managementNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        actions: [expect.objectContaining({ action: "remove", symbol: "SUI" })],
      }),
    );
  });

  it("removes a coin whose latest 5m close is below the minimum price", async () => {
    // PROD:AUTO_REMOVE_COIN_BELOW_MIN_PRICE
    const config = catalog({
      runtime: { autoRemoveSymbolMinPrice: 2 },
    }).config;
    mocks.catalogLoad.mockResolvedValue(
      catalog({ runtime: { autoRemoveSymbolMinPrice: 2 } }),
    );
    const getKlines = vi.fn(async ({ symbol }: any) =>
      symbol === "SUI_USDT"
        ? [kline(NOW - 5 * MINUTE_MS, 1.5)]
        : [kline(NOW - 5 * MINUTE_MS, 3)],
    );

    const result = await runWith(config, contextWith(config), getKlines);

    expect(result.removedSymbols).toEqual(["SUI"]);
    expect(mocks.appendManagement).toHaveBeenCalledWith(
      expect.objectContaining({
        source:
          "slow-trading.sandbox-cycle.coin-management:auto-remove-min-price",
        symbol: "SUI",
      }),
    );
  });

  it("removes a coin below the minimum market cap", async () => {
    // PROD:AUTO_REMOVE_COIN_BELOW_MIN_MARKET_CAP
    const config = catalog({
      runtime: { autoRemoveSymbolMinMarketCapUSD: 100_000_000 },
    }).config;
    mocks.catalogLoad.mockResolvedValue(
      catalog({ runtime: { autoRemoveSymbolMinMarketCapUSD: 100_000_000 } }),
    );
    mocks.getMarketCapUSDMapForSymbols.mockResolvedValue({
      ADA: 200_000_000,
      SUI: 50_000_000,
    });

    const result = await runWith(config, contextWith(config));

    expect(result.removedSymbols).toEqual(["SUI"]);
    expect(mocks.appendManagement).toHaveBeenCalledWith(
      expect.objectContaining({
        source:
          "slow-trading.sandbox-cycle.coin-management:auto-remove-market-cap",
      }),
    );
  });

  it("removes a coin when any stored vPoint meets the percent threshold", async () => {
    // PROD:AUTO_REMOVE_COIN_BY_VPOINT_PCT — the historical scan reads every
    // stored point, not only the latest.
    const config = catalog({
      runtime: { autoRemoveSymbolMinVPointPct: 15 },
    }).config;
    mocks.catalogLoad.mockResolvedValue(
      catalog({ runtime: { autoRemoveSymbolMinVPointPct: 15 } }),
    );
    mocks.vpointsRead.mockImplementation(async ({ symbol }: any) =>
      symbol === "SUI"
        ? [vpoint({ id: "old-spike", pct: 17 }), vpoint({ pct: 5 })]
        : [vpoint({ pct: 3 })],
    );

    const result = await runWith(config, contextWith(config));

    expect(result.removedSymbols).toEqual(["SUI"]);
    expect(mocks.appendManagement).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: expect.stringContaining("old-spike"),
        source:
          "slow-trading.sandbox-cycle.coin-management:auto-remove-vpoint-pct",
      }),
    );
  });

  it("keeps a coin when its market data cannot prove a violation", async () => {
    const config = catalog({
      runtime: {
        autoRemoveSymbolAbsLevel: 6,
        autoRemoveSymbolMinMarketCapUSD: 100,
        autoRemoveSymbolMinPrice: 2,
        autoRemoveSymbolMinVPointPct: 15,
      },
    }).config;
    mocks.catalogLoad.mockResolvedValue(
      catalog({
        runtime: {
          autoRemoveSymbolAbsLevel: 6,
          autoRemoveSymbolMinMarketCapUSD: 100,
          autoRemoveSymbolMinPrice: 2,
          autoRemoveSymbolMinVPointPct: 15,
        },
      }),
    );
    // Every source fails: no price klines, no caps, unreadable vPoints.
    mocks.vpointsRead.mockRejectedValue(new Error("missing file"));

    const result = await runWith(
      config,
      contextWith(config),
      vi.fn(async () => []),
    );

    expect(result.removedSymbols).toEqual([]);
    expect(mocks.catalogUpdate).not.toHaveBeenCalled();
    expect(mocks.appendManagement).not.toHaveBeenCalled();
  });

  it("re-evaluates against the latest catalog inside the commit", async () => {
    // Only the short commit reads fresh storage: a symbol the operator
    // already removed is not re-removed, and the commit writes the latest
    // list minus the still-configured violations.
    const first = catalog({ runtime: { autoRemoveSymbolMinPrice: 2 } });
    const latest = catalog({
      runtime: { autoRemoveSymbolMinPrice: 2 },
      symbols: ["SUI"],
    });
    mocks.catalogLoad
      .mockResolvedValueOnce(first)
      .mockResolvedValue(latest);
    const getKlines = vi.fn(async ({ symbol }: any) =>
      [kline(NOW - 5 * MINUTE_MS, symbol === "SUI_USDT" ? 1 : 1.5)],
    );

    const context = contextWith(latest.config);
    const result = await runWith(first.config, context, getKlines);

    // ADA was evaluated but is no longer configured, so only SUI is removed
    // from the latest list.
    expect(result.removedSymbols).toEqual(["SUI"]);
    expect(mocks.catalogUpdate).toHaveBeenCalledWith({ symbols: [] });
  });

  it("does not write when the violation resolved before commit", async () => {
    const first = catalog({ runtime: { autoRemoveSymbolMinPrice: 2 } });
    const latest = catalog({
      runtime: { autoRemoveSymbolMinPrice: 0 },
    });
    mocks.catalogLoad
      .mockResolvedValueOnce(first)
      .mockResolvedValue(latest);

    const result = await runWith(
      first.config,
      contextWith(latest.config),
      vi.fn(async () => [kline(NOW - 5 * MINUTE_MS, 1)]),
    );

    expect(result.removedSymbols).toEqual([]);
    expect(mocks.catalogUpdate).not.toHaveBeenCalled();
    // The running config still syncs the freshest threshold.
  });

  it("joins all matched rule sources on one removal action", async () => {
    const config = catalog({
      runtime: {
        autoRemoveSymbolMinMarketCapUSD: 100,
        autoRemoveSymbolMinPrice: 2,
      },
      symbols: ["SUI"],
    }).config;
    mocks.catalogLoad.mockResolvedValue(
      catalog({
        runtime: {
          autoRemoveSymbolMinMarketCapUSD: 100,
          autoRemoveSymbolMinPrice: 2,
        },
        symbols: ["SUI"],
      }),
    );
    mocks.getMarketCapUSDMapForSymbols.mockResolvedValue({ SUI: 50 });

    const result = await runWith(
      config,
      contextWith(config),
      vi.fn(async () => [kline(NOW - 5 * MINUTE_MS, 1)]),
    );

    expect(result.removedSymbols).toEqual(["SUI"]);
    expect(mocks.appendManagement).toHaveBeenCalledWith(
      expect.objectContaining({
        source:
          "slow-trading.sandbox-cycle.coin-management:" +
          "auto-remove-min-price+auto-remove-market-cap",
        symbol: "SUI",
      }),
    );
  });
});

describe("entry.findDecisions auto-remove guards", () => {
  function entryContext(overrides: {
    markPriceMap?: Record<string, { lastUpdated: number; price: number }>;
    runtime?: Record<string, unknown>;
    symbols?: string[];
    vPointsMap?: Record<string, VolatilityPoint[]>;
  }): RuntimeContext {
    return {
      adapter: {},
      helper: {},
      state: {
        balance: {
          "acc-1": { available: 500, spendable: 500 },
        },
        config: {
          accounts: [
            {
              enabled: true,
              slug: "acc-1",
              trading: { minEntryAbsLevel: 2 },
            },
          ],
          management: {
            exchangeType: "binance",
            symbols: overrides.symbols ?? ["SUI", "ADA"],
            tradingMode: "futures",
          },
          runtime: {
            autoRemoveSymbolAbsLevel: 0,
            autoRemoveSymbolMinPrice: 0,
            ...overrides.runtime,
          },
        },
        markPriceMap: overrides.markPriceMap ?? {
          ADA: { lastUpdated: NOW, price: 3 },
          SUI: { lastUpdated: NOW, price: 3 },
        },
        mode: "sandbox",
        openPositions: [],
        vPointsMap: overrides.vPointsMap ?? {},
      },
    } as unknown as RuntimeContext;
  }

  it("skips coins that are no longer in the configured Symbols list", async () => {
    // BOTH:AUTO_REMOVE_CONFIGURED_SYMBOL_GUARD — a stale vPoint for a
    // removed coin must not produce an entry signal.
    const context = entryContext({
      symbols: ["SUI"],
      vPointsMap: {
        ADA: [vpoint({ id: "gone", lvl: -4, p: 3 })],
        SUI: [vpoint({ lvl: -3, p: 3 })],
      },
    });

    const decisions = await entry.findDecisions(context);

    expect(decisions.map((decision) => decision.symbol)).toEqual(["SUI"]);
  });

  it("skips signals at or above the auto-removal absolute level", async () => {
    // BOTH:AUTO_REMOVE_COIN_ABOVE_SOME_ABS_LEVEL — the point stays unused.
    const context = entryContext({
      runtime: { autoRemoveSymbolAbsLevel: 6 },
      vPointsMap: {
        ADA: [vpoint({ id: "hi", lvl: -7, p: 3 })],
        SUI: [vpoint({ lvl: -3, p: 3 })],
      },
    });

    const decisions = await entry.findDecisions(context);

    expect(decisions.map((decision) => decision.symbol)).toEqual(["SUI"]);
  });

  it("skips entries whose latest mark is below the minimum price", async () => {
    // BOTH:BLOCK_ENTRY_BELOW_AUTO_REMOVE_MIN_PRICE
    const context = entryContext({
      markPriceMap: {
        ADA: { lastUpdated: NOW, price: 3 },
        SUI: { lastUpdated: NOW, price: 1.5 },
      },
      runtime: { autoRemoveSymbolMinPrice: 2 },
      vPointsMap: {
        ADA: [vpoint({ lvl: -3, p: 3 })],
        SUI: [vpoint({ lvl: -3, p: 1.5 })],
      },
    });

    const decisions = await entry.findDecisions(context);

    expect(decisions.map((decision) => decision.symbol)).toEqual(["ADA"]);
  });
});

describe("entryAction.plan minimum-price guard", () => {
  function planContext(price: number, minimumPrice: number): RuntimeContext {
    return {
      adapter: {
        exchange: {
          getFeeRate: () => 0,
          getRoundTripFeeRate: () => 0,
        },
      },
      helper: {
        getAccountBalance: () => ({
          available: 500,
          locked: 0,
          reserved: 0,
          safeHaven: 0,
          spendable: 500,
          total: 500,
        }),
        getAccountConfig: () => ({}),
      },
      state: {
        balance: {},
        config: {
          accounts: [{ enabled: true, slug: "acc-1", trading: {} }],
          management: {
            exchangeType: "binance",
            symbols: ["SUI"],
            tradingMode: "spot",
          },
          runtime: { autoRemoveSymbolMinPrice: minimumPrice },
        },
        markPriceMap: {
          SUI: { lastUpdated: NOW, price },
        },
        mode: "sandbox",
        openPositions: [],
        vPointsMap: {},
      },
    } as unknown as RuntimeContext;
  }

  const decision = {
    accountSlug: "acc-1",
    direction: "LONG",
    entrySignal: { ...vpoint({ lvl: -3, p: 2 }), investAmount: 50 },
    symbol: "SUI",
    type: "entry",
  } as any;

  it("blocks a plan when the latest mark is below the minimum price", () => {
    // BOTH:BLOCK_ENTRY_BELOW_AUTO_REMOVE_MIN_PRICE — execution-time guard.
    expect(entryAction.plan(planContext(1.5, 2), decision)).toBeNull();
  });

  it("also blocks a forced manual entry below the minimum price", () => {
    expect(
      entryAction.plan(planContext(1.5, 2), { ...decision, manual: true }),
    ).toBeNull();
  });

  it("lets a plan through when the mark is at or above the minimum", () => {
    expect(
      entryAction.plan(planContext(2, 2), decision),
    ).not.toBeNull();
  });
});

describe("entry.getSymbols", () => {
  it("keeps market sync for open positions on removed coins", () => {
    // PROD:AUTO_REMOVE_COIN_WITH_OPEN_POSITION — the removed coin stays in
    // the market-sync list while a position is still managed.
    const symbols = entry.getSymbols(
      {
        management: { symbols: ["SUI"] },
      } as any,
      [
        { symbol: "DOGE" },
        { closed: { t: NOW }, symbol: "ADA" },
      ] as any,
    );
    expect(symbols).toEqual(["BTC", "DOGE", "SUI"]);
  });
});
