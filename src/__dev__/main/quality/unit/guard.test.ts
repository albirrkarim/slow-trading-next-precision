import { describe, expect, it } from "vitest";

import guard from "@/lib/precision/guard";
import type {
  RuntimeContext,
  RuntimeEngineState,
} from "@/lib/precision/types";
import { VOLATILITY_THRESHOLD } from "@/lib/system/constants";
import vpoints from "@/lib/system/utils/vpoints";

const DAY_START = Date.UTC(2026, 5, 18);
const NOW = DAY_START + 12 * 60 * 60 * 1000;

function makeState(
  overrides: Partial<RuntimeEngineState> = {},
): RuntimeEngineState {
  return {
    balance: {},
    config: {
      accounts: [
        { slug: "acc-1", enabled: true, trading: {} },
        { slug: "acc-2", enabled: false, trading: {} },
      ],
      management: { exchangeType: "binance", symbols: ["SUI"], tradingMode: "spot" },
      runtime: {
        autoEntryDailyPnlLimitUSDT: -50,
        autoEntryEnabled: true,
        autoExitEnabled: true,
        runnerEnabled: true,
      },
    },
    currentTime: NOW,
    markPriceMap: { SUI: { lastUpdated: NOW, price: 1.5 } },
    mode: "backtest",
    openPositions: [],
    vPointsMap: {},
    ...overrides,
  } as unknown as RuntimeEngineState;
}

function contextFor(state: RuntimeEngineState): RuntimeContext {
  return { state } as unknown as RuntimeContext;
}

function entry(overrides: Record<string, unknown> = {}) {
  return {
    type: "entry",
    accountSlug: "acc-1",
    symbol: "SUI",
    direction: "LONG",
    message: "test",
    ...overrides,
  } as never;
}

function exit(overrides: Record<string, unknown> = {}) {
  return {
    type: "exit",
    accountSlug: "acc-1",
    symbol: "SUI",
    message: "test",
    position: { control: {} },
    tradeDecision: {},
    ...overrides,
  } as never;
}

function averaging() {
  return {
    type: "averaging",
    accountSlug: "acc-1",
    symbol: "SUI",
    message: "test",
    position: { control: {} },
    recommendation: {},
  } as never;
}

describe("guard.allows — shared environment approval gate", () => {
  it("allows a plain automatic entry when every state check passes", () => {
    expect(guard.allows(entry(), contextFor(makeState()))).toBe(true);
  });

  it("vetoes entries for accounts missing from the runtime config", () => {
    const decision = entry({ accountSlug: "ghost" });
    expect(guard.allows(decision, contextFor(makeState()))).toBe(false);
  });

  it("vetoes automatic actions while runnerEnabled is off; manual bypasses", () => {
    const state = makeState();
    state.config.runtime.runnerEnabled = false;
    expect(guard.allows(entry(), contextFor(state))).toBe(false);
    expect(guard.allows(entry({ manual: true }), contextFor(state))).toBe(
      true,
    );
    expect(guard.allows(exit(), contextFor(state))).toBe(false);
  });

  it("vetoes automatic exits when autoExitEnabled is off; forced exits pass", () => {
    const state = makeState();
    state.config.runtime.autoExitEnabled = false;
    expect(guard.allows(exit(), contextFor(state))).toBe(false);
    expect(
      guard.allows(
        exit({ position: { control: { forceExit: { reason: "x" } } } }),
        contextFor(state),
      ),
    ).toBe(true);
  });

  it("blocks entries and averaging during black-swan protection, incl. manual", () => {
    const state = makeState({ blackSwanProtective: true });
    const context = contextFor(state);
    expect(guard.allows(entry(), context)).toBe(false);
    expect(guard.allows(entry({ manual: true }), context)).toBe(false);
    expect(guard.allows(averaging(), context)).toBe(false);
    // Exits are never blocked by the flag.
    expect(guard.allows(exit(), context)).toBe(true);
  });

  it("vetoes entries for disabled accounts and unconfigured symbols", () => {
    const state = makeState();
    expect(
      guard.allows(entry({ accountSlug: "acc-2" }), contextFor(state)),
    ).toBe(false);
    expect(
      guard.allows(entry({ symbol: "DOGE" }), contextFor(state)),
    ).toBe(false);
    // Normalization: suffixed configured symbols still match base symbols.
    state.config.management.symbols = ["SUI_USDT"];
    expect(guard.allows(entry(), contextFor(state))).toBe(true);
  });

  it("vetoes entries priced below the auto-remove minimum", () => {
    const state = makeState();
    state.config.runtime.autoRemoveSymbolMinPrice = 2;
    expect(guard.allows(entry(), contextFor(state))).toBe(false);
    // Manual entries are still blocked by this guard.
    expect(guard.allows(entry({ manual: true }), contextFor(state))).toBe(
      false,
    );
    // Missing prices never trip the minimum.
    state.markPriceMap = {};
    expect(guard.allows(entry(), contextFor(state))).toBe(true);
  });

  it("vetoes automatic entries when the day's closed PnL reaches the stop", () => {
    const state = makeState({
      dailyPnlDay: new Date(NOW).toISOString().slice(0, 10),
      dailyPnlUsdt: -60,
    });
    expect(guard.allows(entry(), contextFor(state))).toBe(false);
    // Manual entries bypass the daily-PnL stop.
    expect(guard.allows(entry({ manual: true }), contextFor(state))).toBe(
      true,
    );
    // Averaging is unaffected by the entry stop.
    expect(guard.allows(averaging(), contextFor(state))).toBe(true);
  });

  it("ignores a stale accumulator once the UTC day rolls over", () => {
    const state = makeState({
      dailyPnlDay: "2026-06-17", // yesterday
      dailyPnlUsdt: -999,
    });
    expect(guard.allows(entry(), contextFor(state))).toBe(true);
    expect(guard.dailyPnl.resolve(state)).toBe(0);
  });

  it("vetoes entries while an opposite vPoint might already be forming", () => {
    // BOTH:BLOCK_ENTRY_VPOINT_MIGHT_FORMED — the latest point saw a
    // counter-excursion at the detector's activation threshold, so the
    // signal stream is stale even though no new point has emitted yet.
    const stale = {
      id: "T_stale",
      t: NOW - 60_000,
      l: "T",
      p: 1.5,
      pct: 4,
      vb: 1,
      vq: 1,
      lvl: 1,
      maxDownPct: VOLATILITY_THRESHOLD,
    };
    const state = makeState({ vPointsMap: { SUI: [stale] as never[] } });
    expect(guard.allows(entry(), contextFor(state))).toBe(false);
    // Forced entries are blocked by the staleness guard as well.
    expect(
      guard.allows(entry({ manual: true }), contextFor(state)),
    ).toBe(false);

    // Below the threshold the signal is still current.
    const fresh = { ...stale, maxDownPct: VOLATILITY_THRESHOLD - 0.5 };
    const ok = makeState({ vPointsMap: { SUI: [fresh] as never[] } });
    expect(guard.allows(entry(), contextFor(ok))).toBe(true);

    // Only the frontier point matters — an older exhausted point does not
    // veto once a newer one emitted.
    const twoPoints = makeState({
      vPointsMap: { SUI: [stale, fresh] as never[] },
    });
    expect(guard.allows(entry(), contextFor(twoPoints))).toBe(true);
  });

  it("applies the seeded entry cutoff to automatic entries only", () => {
    const state = makeState({ entryCutoffTime: NOW - 1000 });
    expect(guard.allows(entry(), contextFor(state))).toBe(false);
    // Manual entries bypass the backtest entry-window cutoff.
    expect(guard.allows(entry({ manual: true }), contextFor(state))).toBe(
      true,
    );
    // Before the cutoff automatic entries still pass.
    const early = makeState({ entryCutoffTime: NOW + 1000 });
    expect(guard.allows(entry(), contextFor(early))).toBe(true);
    // Exits and averaging ignore the cutoff.
    expect(guard.allows(exit(), contextFor(state))).toBe(true);
    expect(guard.allows(averaging(), contextFor(state))).toBe(true);
  });
});

describe("guard.common — shared checks exposed for strategy gates", () => {
  it("returns the resolved account when shared checks pass, else null", () => {
    const state = makeState();
    const account = state.config.accounts[0];
    expect(guard.common(entry(), contextFor(state))).toBe(account);
    expect(
      guard.common(entry({ accountSlug: "ghost" }), contextFor(state)),
    ).toBeNull();
  });

  it("honors the runner toggle and manual bypass", () => {
    const state = makeState();
    state.config.runtime.runnerEnabled = false;
    expect(guard.common(entry(), contextFor(state))).toBeNull();
    expect(
      guard.common(entry({ manual: true }), contextFor(state)),
    ).toBe(state.config.accounts[0]);
  });

  it("decides exits entirely inside common — autoExit or forced flag", () => {
    const state = makeState();
    state.config.runtime.autoExitEnabled = false;
    expect(guard.common(exit(), contextFor(state))).toBeNull();
    expect(
      guard.common(
        exit({ position: { control: { forceExit: { reason: "x" } } } }),
        contextFor(state),
      ),
    ).toBe(state.config.accounts[0]);
  });

  it("vetoes entries during black-swan but lets exits through", () => {
    const state = makeState({ blackSwanProtective: true });
    expect(guard.common(entry({ manual: true }), contextFor(state))).toBeNull();
    expect(guard.common(exit(), contextFor(state))).toBe(
      state.config.accounts[0],
    );
  });
});

describe("guard.entry.capacity / policy — decomposed entry gate", () => {
  function open(overrides: Record<string, unknown> = {}) {
    return {
      account: "acc-1",
      symbol: "SUI",
      closed: false,
      ...overrides,
    } as never;
  }

  it("capacity vetoes a same-symbol open position", () => {
    const state = makeState({ openPositions: [open()] });
    const account = state.config.accounts[0];
    expect(
      guard.entry.capacity(entry(), contextFor(state), account as never),
    ).toBe(false);
  });

  it("capacity enforces maxOpenPositions; zero means unlimited", () => {
    const state = makeState({
      openPositions: [open({ symbol: "DOGE" })],
    });
    const account = state.config.accounts[0];
    account.trading.maxOpenPositions = 1;
    expect(
      guard.entry.capacity(entry(), contextFor(state), account as never),
    ).toBe(false);
    account.trading.maxOpenPositions = 0;
    expect(
      guard.entry.capacity(entry(), contextFor(state), account as never),
    ).toBe(true);
  });

  it("policy ignores slot inventory — the split a strategy gate reuses", () => {
    const state = makeState({ openPositions: [open()] });
    expect(guard.entry.policy(entry(), contextFor(state))).toBe(true);
  });

  it("allows composes enabled + capacity + policy", () => {
    const state = makeState({ openPositions: [open()] });
    const account = state.config.accounts[0];
    expect(
      guard.entry.allows(entry(), contextFor(state), account as never),
    ).toBe(false);
    expect(
      guard.entry.allows(
        entry({ symbol: "DOGE" }),
        contextFor(state),
        account as never,
      ),
    ).toBe(false); // DOGE is outside the configured catalog
  });
});

describe("vpoints.excursions.update — max excursion tracking", () => {
  const point = { p: 100, maxUpPct: undefined, maxDownPct: undefined };

  it("tracks the largest up and down excursion from the point price", () => {
    const p = { ...point } as never;
    vpoints.excursions.update(p, 103);
    expect((p as any).maxUpPct).toBeCloseTo(3);
    expect((p as any).maxDownPct).toBe(0);

    vpoints.excursions.update(p, 95);
    expect((p as any).maxUpPct).toBeCloseTo(3);
    expect((p as any).maxDownPct).toBeCloseTo(5);

    // Smaller moves never shrink the tracked max.
    vpoints.excursions.update(p, 99);
    expect((p as any).maxUpPct).toBeCloseTo(3);
    expect((p as any).maxDownPct).toBeCloseTo(5);
  });

  it("ignores non-finite prices and unusable points", () => {
    const p = { p: 0 } as never;
    vpoints.excursions.update(p, 10);
    expect((p as any).maxUpPct).toBeUndefined();
    vpoints.excursions.update({ ...point } as never, Number.NaN);
  });
});

describe("guard.dailyPnl.recordClose — shared close bookkeeping", () => {
  it("accumulates net USDT into the current UTC day", () => {
    const state = makeState();
    guard.dailyPnl.recordClose(state, -30);
    guard.dailyPnl.recordClose(state, -25);
    guard.dailyPnl.recordClose(state, 10);
    expect(state.dailyPnlDay).toBe(new Date(NOW).toISOString().slice(0, 10));
    expect(state.dailyPnlUsdt).toBe(-45);
    expect(guard.dailyPnl.resolve(state)).toBe(-45);
  });

  it("resets the accumulator when the recorded day is stale", () => {
    const state = makeState({
      dailyPnlDay: "2026-06-17",
      dailyPnlUsdt: -200,
    });
    guard.dailyPnl.recordClose(state, -10);
    expect(state.dailyPnlDay).toBe(new Date(NOW).toISOString().slice(0, 10));
    expect(state.dailyPnlUsdt).toBe(-10);
  });

  it("ignores missing or non-finite PnL", () => {
    const state = makeState();
    guard.dailyPnl.recordClose(state, undefined);
    guard.dailyPnl.recordClose(state, Number.NaN);
    expect(state.dailyPnlUsdt).toBeUndefined();
  });
});
