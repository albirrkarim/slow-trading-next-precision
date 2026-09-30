import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MINUTE_MS = 60_000;

const mocks = vi.hoisted(() => ({
  central: vi.fn(async () => true),
  createInitialBalance: vi.fn(() => ({})),
  createInitialVPointsMap: vi.fn(async () => ({})),
  createProgressLogger: vi.fn(() => () => undefined),
  engineStart: vi.fn(async () => undefined),
  engines: [] as Array<{ adapter: any; state: any }>,
  prepareDataset: vi.fn(),
  snapshotAccountBalances: vi.fn(() => ({})),
}));

vi.mock("@/lib/system/notification", () => ({
  monitorNotif: { run: vi.fn(async () => undefined) },
  systemNotif: { central: mocks.central },
}));

vi.mock("@/lib/system/logging", () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  systemLog: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock("@/lib/precision", () => ({
  RuntimeEngine: vi.fn(function RuntimeEngine(this: any, state: any, adapter: any) {
    this.state = state;
    this.adapter = adapter;
    this.start = mocks.engineStart;
    mocks.engines.push({ adapter, state });
  }),
}));

vi.mock("@/lib/dev/backtestPrecision/backtest/data", () => ({
  preparePrecisionDataset: mocks.prepareDataset,
}));

vi.mock("@/lib/dev/backtestPrecision/backtest/utils", () => ({
  createInitialBalance: mocks.createInitialBalance,
  createInitialVPointsMap: mocks.createInitialVPointsMap,
  createProgressLogger: mocks.createProgressLogger,
  snapshotAccountBalances: mocks.snapshotAccountBalances,
}));

import { TradingMode } from "@/lib/exchange";
import { precisionBacktest } from "@/lib/dev/backtestPrecision/backtest";
import { VPOINT_WARMUP_MS } from "@/lib/dev/backtestPrecision/backtest/backtest-precision-types";
import backtestBlackSwan from "@/lib/dev/backtestPrecision/backtest/black-swan";
import guard from "@/lib/precision/guard";
import { createRuntimeHelper } from "@/lib/precision/helper";
import monitoring from "@/lib/precision/monitoring";
import schedule from "@/lib/precision/monitoring/schedule";
import type {
  RuntimeContext,
  RuntimeEngineAdapter,
  RuntimeEngineState,
} from "@/lib/precision/types";
import tradingExit from "@/lib/system/trading/exit";
import type { Kline } from "@/lib/system/types";
import { createTestPosition } from "../fixtures/position";

const NOW = Date.UTC(2026, 8, 3, 10, 4);
const DATASET_START = Date.UTC(2024, 0, 1);
const realMonitor = monitoring.position.monitor;

function candle(openTime: number, close: number): Kline {
  return [
    openTime,
    String(close),
    String(close),
    String(close),
    String(close),
    "1",
    openTime + MINUTE_MS - 1,
  ] as never;
}

function windowCandles(now: number, latestClose: number, crashMinutes = 2): Kline[] {
  const latestOpen = Math.floor(now / MINUTE_MS) * MINUTE_MS - MINUTE_MS;
  const candles: Kline[] = [];
  for (
    let open = latestOpen - 64 * MINUTE_MS;
    open <= latestOpen;
    open += MINUTE_MS
  ) {
    candles.push(
      candle(
        open,
        open > latestOpen - crashMinutes * MINUTE_MS ? latestClose : 100,
      ),
    );
  }
  return candles;
}

function klinesReturning(
  bySymbol: Record<string, Kline[] | ((endTime: number) => Kline[])>,
) {
  return vi.fn(async (params: any) => {
    const base = String(params.symbol)
      .replace(/_?USDT$/, "")
      .toUpperCase();
    const candles = bySymbol[base];
    return typeof candles === "function"
      ? candles(Number(params.endTime))
      : (candles ?? []);
  });
}

interface HookContextOptions {
  balance?: Record<string, unknown>;
  blackSwan?: unknown;
  getKlines?: ReturnType<typeof vi.fn>;
  positions?: unknown[];
  realHelper?: boolean;
  symbols?: string[];
  tradingMode?: string;
  updateMarkPrice?: ReturnType<typeof vi.fn>;
}

function makeContext(options: HookContextOptions = {}, now = NOW) {
  const state = {
    balance: options.balance ?? {},
    config: {
      accounts: [
        { enabled: true, slug: "acc-1", trading: {} },
        { enabled: false, slug: "acc-2", trading: {} },
      ],
      management: {
        blackSwan: options.blackSwan ?? { enabled: true },
        exchangeType: "binance",
        symbols: options.symbols ?? ["SUI"],
        tradingMode: options.tradingMode ?? "futures",
      },
      runtime: {
        autoEntryEnabled: true,
        autoExitEnabled: true,
        runnerEnabled: true,
      },
    },
    currentTime: now,
    markPriceMap: {},
    mode: "backtest",
    openPositions: options.positions ?? [],
    vPointsMap: {},
  } as unknown as RuntimeEngineState;

  const adapter = {
    exchange: { getFeeRate: () => 0, getRoundTripFeeRate: () => 0 },
    market: {
      getKlines: options.getKlines ?? vi.fn(async () => []),
    },
    onAction: vi.fn(async () => null),
    onExit: vi.fn(async () => undefined),
    onNotif: () => true,
  } as unknown as RuntimeEngineAdapter;

  const helper = options.realHelper
    ? createRuntimeHelper(state, adapter)
    : ({
        market: {
          updateMarkPrice:
            options.updateMarkPrice ?? vi.fn(async () => undefined),
        },
      } as unknown as RuntimeContext["helper"]);

  const context = { adapter, helper, state } as RuntimeContext;
  return { adapter, context, helper, state };
}

function entryDecision() {
  return {
    accountSlug: "acc-1",
    direction: "LONG",
    message: "test",
    symbol: "SUI",
    type: "entry",
  } as never;
}

function averagingDecision() {
  return {
    accountSlug: "acc-1",
    message: "test",
    position: { control: {} },
    recommendation: {},
    symbol: "SUI",
    type: "averaging",
  } as never;
}

function exitDecision() {
  return {
    accountSlug: "acc-1",
    message: "test",
    position: { control: { forceExit: { reason: "x" } } },
    symbol: "SUI",
    tradeDecision: {},
    type: "exit",
  } as never;
}

describe("backtestBlackSwan.riskSentinel", () => {
  let monitorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    monitorSpy = vi
      .spyOn(monitoring.position, "monitor")
      .mockImplementation(async () => undefined);
  });

  afterEach(() => {
    monitorSpy.mockRestore();
  });

  it("reports NORMAL on healthy BTC candles and never reads breadth", async () => {
    const getKlines = klinesReturning({ BTC: windowCandles(NOW, 100) });
    const { context, state } = makeContext({ getKlines });
    const patch = await backtestBlackSwan.riskSentinel.create()(context);

    expect(state.blackSwanProtective).toBe(false);
    expect(patch?.summary).toMatch(/NORMAL \(HEALTHY\)/);
    expect(patch?.symbols).toBe(1);
    expect(getKlines).toHaveBeenCalledTimes(1);
    expect(monitorSpy).not.toHaveBeenCalled();
    expect(mocks.central).not.toHaveBeenCalled();
  });

  it("requests the closed 1m 65-minute BTC window at simulated now for each market type", async () => {
    for (const [tradingMode, marketType] of [
      ["futures", "FUTURES"],
      ["spot", "SPOT"],
    ] as const) {
      const getKlines = klinesReturning({ BTC: windowCandles(NOW, 100) });
      const { context } = makeContext({ getKlines, tradingMode });
      await backtestBlackSwan.riskSentinel.create()(context);
      expect(getKlines).toHaveBeenCalledWith(
        expect.objectContaining({
          endTime: NOW,
          interval: "1m",
          marketType,
          minutes: 65,
          symbol: "BTC_USDT",
        }),
      );
    }
  });

  it("escalates a BTC warning drop to WATCH and fetches breadth", async () => {
    const getKlines = klinesReturning({
      BTC: windowCandles(NOW, 95),
      SUI: windowCandles(NOW, 100),
    });
    const { context, state } = makeContext({ getKlines });
    const patch = await backtestBlackSwan.riskSentinel.create()(context);

    expect(patch?.summary).toMatch(/WATCH \(BTC_WARNING\)/);
    expect(state.blackSwanProtective).toBe(true);
    expect(patch?.symbols).toBe(2);
    expect(monitorSpy).not.toHaveBeenCalled();
  });

  it("escalates a BTC hard trigger to CRISIS without notifying", async () => {
    const getKlines = klinesReturning({
      BTC: windowCandles(NOW, 90),
      SUI: windowCandles(NOW, 100),
    });
    const { context, state } = makeContext({ getKlines });
    const patch = await backtestBlackSwan.riskSentinel.create()(context);

    expect(patch?.summary).toMatch(/CRISIS \(BTC_HARD_TRIGGER\)/);
    expect(state.blackSwanProtective).toBe(true);
    expect(mocks.central).not.toHaveBeenCalled();
  });

  it("confirms a systemic-breadth CRISIS when enough configured symbols crash", async () => {
    const getKlines = klinesReturning({
      ADA: windowCandles(NOW, 91),
      BTC: windowCandles(NOW, 95),
      DOGE: windowCandles(NOW, 100),
      ETH: windowCandles(NOW, 91),
      SUI: windowCandles(NOW, 91),
      XRP: windowCandles(NOW, 100),
    });
    const { context } = makeContext({
      getKlines,
      symbols: ["SUI", "ETH", "ADA", "DOGE", "XRP"],
    });
    const patch = await backtestBlackSwan.riskSentinel.create()(context);

    expect(patch?.summary).toMatch(/CRISIS \(SYSTEMIC_BREADTH\)/);
    expect(patch?.symbols).toBe(6);
  });

  it("excludes a failing breadth read from the valid-symbol count", async () => {
    const getKlines = vi.fn(async (params: any) => {
      const base = String(params.symbol)
        .replace(/_?USDT$/, "")
        .toUpperCase();
      if (base === "ETH") throw new Error("read failed");
      if (base === "BTC") return windowCandles(NOW, 95);
      return windowCandles(NOW, 91);
    });
    const { context } = makeContext({
      blackSwan: {
        enabled: true,
        breadthConfirmation: { minimumValidSymbols: 2 },
      },
      getKlines,
      symbols: ["SUI", "ETH"],
    });
    const patch = await backtestBlackSwan.riskSentinel.create()(context);

    expect(patch?.summary).toMatch(/WATCH \(BTC_WARNING\)/);
    expect(patch?.summary).not.toMatch(/SYSTEMIC_BREADTH/);
    expect(patch?.symbols).toBe(2);
    expect(mocks.central).not.toHaveBeenCalled();
  });

  it("excludes BTC and dedupes normalized symbols for breadth reads", async () => {
    const getKlines = klinesReturning({
      BTC: windowCandles(NOW, 95),
      ETH: windowCandles(NOW, 100),
      SUI: windowCandles(NOW, 100),
    });
    const { context } = makeContext({
      getKlines,
      symbols: ["BTC", "BTC_USDT", "SUI", "sui_usdt", "ETH"],
    });
    await backtestBlackSwan.riskSentinel.create()(context);

    expect(getKlines.mock.calls.map(([params]: any[]) => params.symbol)).toEqual(
      ["BTC_USDT", "SUI_USDT", "ETH_USDT"],
    );
  });

  it("ignores a crash that only exists in candles closed after simulated now", async () => {
    const future: Kline[] = [];
    for (let open = NOW + MINUTE_MS; open <= NOW + 65 * MINUTE_MS; open += MINUTE_MS) {
      future.push(candle(open, 10));
    }
    const getKlines = klinesReturning({ BTC: future });
    const { context, state } = makeContext({ getKlines });
    const patch = await backtestBlackSwan.riskSentinel.create()(context);

    expect(patch?.summary).toMatch(/WATCH \(DATA_STALE\)/);
    expect(patch?.summary).not.toMatch(/CRISIS/);
    expect(state.blackSwanProtective).toBe(true);
    expect(monitorSpy).not.toHaveBeenCalled();
  });

  it("ignores future crash candles mixed into a healthy closed window", async () => {
    const future: Kline[] = [];
    for (
      let open = NOW + MINUTE_MS;
      open <= NOW + 65 * MINUTE_MS;
      open += MINUTE_MS
    ) {
      future.push(candle(open, 10));
    }
    const getKlines = klinesReturning({
      BTC: [...windowCandles(NOW, 100), ...future],
    });
    const { context, state } = makeContext({ getKlines });
    const patch = await backtestBlackSwan.riskSentinel.create()(context);

    expect(patch?.summary).toMatch(/NORMAL \(HEALTHY\)/);
    expect(state.blackSwanProtective).toBe(false);
    expect(getKlines).toHaveBeenCalledTimes(1);
    expect(monitorSpy).not.toHaveBeenCalled();
    expect(mocks.central).not.toHaveBeenCalled();
  });

  it("fails closed to WATCH on missing, empty, stale, or failing BTC reads", async () => {
    const scenarios = [
      klinesReturning({}),
      klinesReturning({ BTC: [] }),
      klinesReturning({ BTC: windowCandles(NOW - 10 * MINUTE_MS, 100) }),
      vi.fn(async () => {
        throw new Error("dataset offline");
      }),
    ];
    for (const getKlines of scenarios) {
      const { context, state } = makeContext({ getKlines });
      const patch = await backtestBlackSwan.riskSentinel.create()(context);
      expect(patch?.summary).toMatch(/WATCH \(DATA_STALE\)/);
      expect(state.blackSwanProtective).toBe(true);
    }
  });

  it("keeps CRISIS through a stale tick instead of downgrading", async () => {
    const getKlines = klinesReturning({
      BTC: (endTime) => (endTime === NOW ? windowCandles(NOW, 90) : []),
    });
    const { context, state } = makeContext({ getKlines });
    const hook = backtestBlackSwan.riskSentinel.create();

    const first = await hook(context);
    expect(first?.summary).toMatch(/CRISIS/);

    state.currentTime += MINUTE_MS;
    const second = await hook(context);
    expect(second?.summary).toMatch(/CRISIS \(DATA_STALE\)/);
    expect(state.blackSwanProtective).toBe(true);
  });

  it("clears a seeded protective flag without candle reads when disabled", async () => {
    const getKlines = klinesReturning({ BTC: windowCandles(NOW, 90) });
    const { context, state } = makeContext({
      blackSwan: { enabled: false },
      getKlines,
    });
    state.blackSwanProtective = true;
    const patch = await backtestBlackSwan.riskSentinel.create()(context);

    expect(state.blackSwanProtective).toBe(false);
    expect(getKlines).not.toHaveBeenCalled();
    expect(patch?.summary).toMatch(/NORMAL \(DISABLED\)/);
    expect(patch?.symbols).toBe(0);
  });

  it("vetoes entries and averaging through the real shared guard while protective", async () => {
    const getKlines = klinesReturning({
      BTC: (endTime) => windowCandles(endTime, endTime === NOW ? 100 : 90),
    });
    const { context, state } = makeContext({ getKlines });
    const hook = backtestBlackSwan.riskSentinel.create();

    await hook(context);
    expect(guard.allows(entryDecision(), context)).toBe(true);

    state.currentTime += MINUTE_MS;
    await hook(context);
    expect(state.blackSwanProtective).toBe(true);
    expect(guard.allows(entryDecision(), context)).toBe(false);
    expect(guard.allows(averagingDecision(), context)).toBe(false);
    expect(guard.allows(exitDecision(), context)).toBe(true);
  });

  it("recovers through RECOVERY to NORMAL after cooldown without manual ack", async () => {
    const getKlines = klinesReturning({
      BTC: (endTime) => windowCandles(endTime, endTime === NOW ? 90 : 100),
    });
    const { context, state } = makeContext({
      blackSwan: {
        enabled: true,
        recoveryCooldownMinutes: 60,
        requireManualLiveRecovery: true,
      },
      getKlines,
    });
    const hook = backtestBlackSwan.riskSentinel.create();

    const crisis = await hook(context);
    expect(crisis?.summary).toMatch(/CRISIS/);

    state.currentTime += MINUTE_MS;
    const recovering = await hook(context);
    expect(recovering?.summary).toMatch(/RECOVERY/);
    expect(state.blackSwanProtective).toBe(true);
    expect(guard.allows(entryDecision(), context)).toBe(false);

    state.currentTime += 60 * MINUTE_MS;
    const healed = await hook(context);
    expect(healed?.summary).toMatch(/NORMAL \(HEALTHY\)/);
    expect(state.blackSwanProtective).toBe(false);
    expect(mocks.central).not.toHaveBeenCalled();
  });

  it("keeps detector state isolated between independently created hooks", async () => {
    const crashing = klinesReturning({ BTC: windowCandles(NOW, 90) });
    const crisisContext = makeContext({ getKlines: crashing });
    const first = await backtestBlackSwan
      .riskSentinel.create()(crisisContext.context);
    expect(first?.summary).toMatch(/CRISIS/);

    const healthy = klinesReturning({ BTC: windowCandles(NOW, 100) });
    const { context, state } = makeContext({ getKlines: healthy });
    const patch = await backtestBlackSwan.riskSentinel.create()(context);
    expect(patch?.summary).toMatch(/NORMAL/);
    expect(state.blackSwanProtective).toBe(false);
  });

  it("FREEZE_ONLY marks protection without touching positions", async () => {
    const position = createTestPosition({ account: "acc-1", symbol: "SUI" });
    const getKlines = klinesReturning({ BTC: windowCandles(NOW, 90) });
    const { context, state } = makeContext({
      blackSwan: { enabled: true, exitPolicy: "FREEZE_ONLY" },
      getKlines,
      positions: [position],
    });
    const patch = await backtestBlackSwan.riskSentinel.create()(context);

    expect(patch?.summary).toMatch(/CRISIS/);
    expect(state.blackSwanProtective).toBe(true);
    expect(monitorSpy).not.toHaveBeenCalled();
    expect(position.control?.forceExit).toBeUndefined();
    expect(patch?.reports).toBe(0);
  });

  it("CLOSE_ADVERSE selects only LONG legs on futures", async () => {
    const long = createTestPosition({
      account: "acc-1",
      direction: "LONG",
      symbol: "SUI",
    });
    const short = createTestPosition({
      account: "acc-1",
      direction: "SHORT",
      symbol: "SUI",
    });
    const getKlines = klinesReturning({ BTC: windowCandles(NOW, 90) });
    const { context } = makeContext({
      blackSwan: { enabled: true, exitPolicy: "CLOSE_ADVERSE" },
      getKlines,
      positions: [long, short],
    });
    await backtestBlackSwan.riskSentinel.create()(context);

    expect(monitorSpy).toHaveBeenCalledTimes(1);
    expect(monitorSpy).toHaveBeenCalledWith(expect.anything(), long);
    expect(long.control?.forceExit?.reason).toBe("BLACK_SWAN:BTC_HARD_TRIGGER");
    expect(short.control?.forceExit).toBeUndefined();
  });

  it("FLATTEN_ALL selects both directions on futures", async () => {
    const long = createTestPosition({ account: "acc-1", symbol: "SUI" });
    const short = createTestPosition({
      account: "acc-1",
      direction: "SHORT",
      symbol: "ETH",
    });
    const getKlines = klinesReturning({ BTC: windowCandles(NOW, 90) });
    const { context } = makeContext({
      blackSwan: { enabled: true, exitPolicy: "FLATTEN_ALL" },
      getKlines,
      positions: [long, short],
    });
    await backtestBlackSwan.riskSentinel.create()(context);

    expect(monitorSpy).toHaveBeenCalledTimes(2);
    expect(short.control?.forceExit?.reason).toBe("BLACK_SWAN:BTC_HARD_TRIGGER");
  });

  it("CLOSE_ADVERSE selects spot positions regardless of direction", async () => {
    const short = createTestPosition({
      account: "acc-1",
      direction: "SHORT",
      symbol: "SUI",
      tradingMode: TradingMode.SPOT,
    });
    const getKlines = klinesReturning({ BTC: windowCandles(NOW, 90) });
    const { context } = makeContext({
      blackSwan: { enabled: true, exitPolicy: "CLOSE_ADVERSE" },
      getKlines,
      positions: [short],
      tradingMode: "spot",
    });
    await backtestBlackSwan.riskSentinel.create()(context);

    expect(monitorSpy).toHaveBeenCalledTimes(1);
    expect(monitorSpy).toHaveBeenCalledWith(expect.anything(), short);
  });

  it("skips closed rows and still selects disabled accounts' open positions", async () => {
    const closed = createTestPosition({
      account: "acc-1",
      closed: { feeUsdt: 0, price: 9, reason: "TAKE_PROFIT", t: NOW },
      symbol: "SUI",
    });
    const disabledAccountPosition = createTestPosition({
      account: "acc-2",
      symbol: "ETH",
    });
    const getKlines = klinesReturning({ BTC: windowCandles(NOW, 90) });
    const { context } = makeContext({
      getKlines,
      positions: [closed, disabledAccountPosition],
    });
    await backtestBlackSwan.riskSentinel.create()(context);

    expect(monitorSpy).toHaveBeenCalledTimes(1);
    expect(monitorSpy).toHaveBeenCalledWith(
      expect.anything(),
      disabledAccountPosition,
    );
    expect(closed.control?.forceExit).toBeUndefined();
  });

  it("refreshes the 1m mark price before monitoring selected positions", async () => {
    const order: string[] = [];
    const updateMarkPrice = vi.fn(async (interval?: string) => {
      order.push(`mark:${interval}`);
    });
    monitorSpy.mockImplementation(async () => {
      order.push("monitor");
    });
    const position = createTestPosition({ account: "acc-1", symbol: "SUI" });
    const getKlines = klinesReturning({ BTC: windowCandles(NOW, 90) });
    const { context } = makeContext({
      getKlines,
      positions: [position],
      updateMarkPrice,
    });
    await backtestBlackSwan.riskSentinel.create()(context);

    expect(updateMarkPrice).toHaveBeenCalledWith("1m");
    expect(order).toEqual(["mark:1m", "monitor"]);
  });

  it("preserves existing control fields while stamping the BLACK_SWAN reason", async () => {
    const position = createTestPosition({ account: "acc-1", symbol: "SUI" });
    (position as { control?: Record<string, unknown> }).control = {
      keepMe: 1,
    };
    const getKlines = klinesReturning({ BTC: windowCandles(NOW, 90) });
    const { context } = makeContext({ getKlines, positions: [position] });
    await backtestBlackSwan.riskSentinel.create()(context);

    expect(position.control).toEqual({
      forceExit: { reason: "BLACK_SWAN:BTC_HARD_TRIGGER" },
      keepMe: 1,
    });
  });

  it("closes a crisis-selected position through the real monitoring pipeline", async () => {
    monitorSpy.mockImplementation(realMonitor);
    const position = createTestPosition({
      account: "acc-1",
      entryPrice: 10,
      marginUsdt: 10,
      notionalUsdt: 10,
      quantity: 1,
      symbol: "SUI",
    });
    const exited: unknown[] = [];
    const balance = {
      "acc-1": {
        available: 100,
        locked: 10,
        reserved: 0,
        safeHaven: 0,
        spendable: 100,
        startingBalance: 110,
        total: 110,
      },
    };
    const getKlines = klinesReturning({
      BTC: windowCandles(NOW, 90),
      SUI: windowCandles(NOW, 9),
    });
    const { adapter, context, state } = makeContext({
      balance,
      getKlines,
      positions: [position],
      realHelper: true,
    });
    adapter.onAction = vi.fn(async (decision: any, ctx: RuntimeContext) =>
      decision.type === "exit" ? tradingExit.execute(ctx, decision) : null,
    );
    adapter.onExit = vi.fn(async (closed: unknown) => {
      exited.push(closed);
    });
    state.config.runtime.autoExitEnabled = false;

    const patch = await backtestBlackSwan.riskSentinel.create()(context);

    expect(patch?.reports).toBe(1);
    expect(state.openPositions).toHaveLength(0);
    expect(exited).toHaveLength(1);
    const closed = exited[0] as {
      closed: { message: string; reason: string };
    };
    expect(closed.closed.reason).toBe("FORCED");
    expect(closed.closed.message).toContain("BLACK_SWAN:BTC_HARD_TRIGGER");
    expect(state.markPriceMap.SUI?.price).toBe(9);
    expect(balance["acc-1"].locked).toBe(0);
    expect(balance["acc-1"].available).toBeCloseTo(109);
    expect(mocks.central).not.toHaveBeenCalled();
  });
});

function configWith(blackSwan?: unknown) {
  return {
    accounts: [{ enabled: true, slug: "acc-1", trading: {} }],
    management: {
      blackSwan,
      exchangeType: "binance",
      symbols: ["SUI"],
      tradingMode: "spot",
    },
    runtime: {
      autoEntryEnabled: true,
      autoExitEnabled: true,
      blackSwanStageIntervalMinutes: 1,
      captureEntryStageIntervalMinutes: 5,
      runnerEnabled: true,
      standardMonitoringStageIntervalMinutes: 5,
    },
  } as never;
}

async function runBacktest(params: Record<string, unknown>) {
  const startTime = DATASET_START + VPOINT_WARMUP_MS;
  const endTime = startTime + 10 * MINUTE_MS;
  mocks.prepareDataset.mockResolvedValue({
    endTime,
    getKlines: vi.fn(async () => []),
    startTime: DATASET_START,
    symbols: ["BTC", "SUI"],
  });
  return precisionBacktest({
    config: configWith(params.blackSwan),
    range: "6month",
    upToDateDecisionBacktest: false,
    upToDateKlines: false,
    ...params,
  } as never);
}

describe("precisionBacktest risk-sentinel wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.engines.length = 0;
  });

  it("supplies the sentinel hook on an enabled normal run and the scheduler honors its interval", async () => {
    await runBacktest({ blackSwan: { enabled: true } });

    const { adapter, state } = mocks.engines.at(-1)!;
    expect(typeof adapter.onRiskSentinel).toBe("function");

    const state2 = state as RuntimeEngineState;
    state2.currentTime = 10 * MINUTE_MS;
    expect(schedule.getNextTime(state2, adapter)).toBe(11 * MINUTE_MS);
    expect(schedule.getNextTime(state2)).toBe(15 * MINUTE_MS);
  });

  it("omits the sentinel hook on a disabled normal run", async () => {
    await runBacktest({ blackSwan: { enabled: false } });
    await runBacktest({ blackSwan: undefined });

    expect(mocks.engines[0].adapter.onRiskSentinel).toBeUndefined();
    expect(mocks.engines[1].adapter.onRiskSentinel).toBeUndefined();
  });

  it("keeps the seeded protective flag without a hook on precision-checker runs", async () => {
    const startTime = DATASET_START + VPOINT_WARMUP_MS;
    const endTime = startTime + 10 * MINUTE_MS;
    mocks.prepareDataset.mockResolvedValue({
      endTime,
      getKlines: vi.fn(async () => []),
      startTime: DATASET_START,
      symbols: ["BTC", "SUI"],
    });

    await precisionBacktest({
      config: configWith({ enabled: true }),
      endTime,
      initialState: {
        balance: {},
        blackSwanProtective: true,
        openPositions: [],
        vPointsMap: {},
      },
      mode: "precision-checker",
      range: "custom",
      startTime,
      upToDateDecisionBacktest: false,
      upToDateKlines: false,
    } as never);

    const { adapter, state } = mocks.engines.at(-1)!;
    expect(adapter.onRiskSentinel).toBeUndefined();
    expect(state.blackSwanProtective).toBe(true);
  });
});
