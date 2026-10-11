import { describe, expect, it, vi } from "vitest";

import { makeConfigDraft } from "@/components/settings/helpers";
import indicators from "@/lib/features/indicators";
import type {
  FeatureIndicatorConfig,
  SupertrendAccumulator,
  VwapAccumulator,
} from "@/lib/features/indicators";
import type { RuntimeContext } from "@/lib/precision/types";
import runtimeAccountConfig from "@/lib/system/runtime/account-config";
import runtimeDefaults from "@/lib/system/runtime/defaults";
import type { Kline } from "@/lib/system/types/market";

const MINUTE_MS = 60_000;
const CANDLE_MS = 5 * MINUTE_MS;
const NOW = Date.UTC(2026, 0, 15, 12, 0);
const VWAP_KEY = "vwap:5m:month";

function kline(
  openTime: number,
  price = 10,
  volume = 1,
  widthMs = CANDLE_MS,
): Kline {
  return [
    openTime,
    String(price),
    String(price),
    String(price),
    String(price),
    String(volume),
    openTime + widthMs - 1,
  ] as unknown as Kline;
}

/** Consecutive klines `[fromMs, toMs)` at `widthMs`. */
function series(fromMs: number, toMs: number, widthMs = CANDLE_MS): Kline[] {
  const out: Kline[] = [];
  for (let t = fromMs; t < toMs; t += widthMs) out.push(kline(t, 10, 1, widthMs));
  return out;
}

function contextWith(params: {
  closedKlines?: ReturnType<typeof vi.fn>;
  getKlines?: ReturnType<typeof vi.fn>;
  indicators?: FeatureIndicatorConfig[];
  now?: number;
  symbols?: string[];
}): RuntimeContext {
  return {
    adapter: {
      market: {
        getKlines: params.getKlines ?? vi.fn(async () => []),
        live: params.closedKlines
          ? { closedKlines: params.closedKlines, track: vi.fn() }
          : undefined,
      },
    },
    state: {
      config: {
        management: { indicators: params.indicators, tradingMode: "futures" },
      },
      currentTime: params.now ?? NOW,
      vPointsMap: Object.fromEntries(
        (params.symbols ?? ["SUI"]).map((symbol) => [symbol, []]),
      ),
    },
  } as unknown as RuntimeContext;
}

function vwapAcc(context: RuntimeContext, symbol = "SUI"): VwapAccumulator {
  return context.state.features!.acc![VWAP_KEY][symbol] as VwapAccumulator;
}

// BOTH:INDICATOR_FEATURES
describe("indicators.feed.update — default monthly VWAP", () => {
  it("folds buffer candles into the accumulator without touching REST", async () => {
    const getKlines = vi.fn(async () => []);
    const closedKlines = vi.fn(() => [kline(NOW - CANDLE_MS)]);
    const context = contextWith({ closedKlines, getKlines });

    await indicators.feed.update(context);

    const acc = vwapAcc(context);
    expect(acc.v).toBe(1);
    expect(acc.t).toBe(NOW - CANDLE_MS);
    expect(getKlines).not.toHaveBeenCalled();
  });

  it("backfills through REST when the live buffer cannot cover the window", async () => {
    const getKlines = vi.fn(async () => [kline(NOW - CANDLE_MS)]);
    const context = contextWith({ closedKlines: vi.fn(() => undefined), getKlines });

    await indicators.feed.update(context);

    expect(getKlines).toHaveBeenCalledWith(
      expect.objectContaining({
        interval: "5m",
        startTime: Date.UTC(2026, 0, 1),
        symbol: "SUI_USDT",
      }),
    );
    expect(vwapAcc(context).v).toBe(1);
  });

  it("does not refold candles the cursor already consumed", async () => {
    const candle = kline(NOW - CANDLE_MS);
    const context = contextWith({ getKlines: vi.fn(async () => [candle]) });
    await indicators.feed.update(context);
    await indicators.feed.update(context);

    expect(vwapAcc(context).n).toBe(1);
  });

  it("restarts the accumulator when the month anchor rolls over", async () => {
    const getKlines = vi.fn().mockImplementation(async () => [kline(NOW - CANDLE_MS)]);
    const context = contextWith({ getKlines });
    await indicators.feed.update(context);
    expect(vwapAcc(context).n).toBe(1);

    context.state.currentTime = Date.UTC(2026, 1, 1, 12, 0);
    getKlines.mockImplementation(async () => [kline(context.state.currentTime - CANDLE_MS)]);
    await indicators.feed.update(context);

    const acc = vwapAcc(context);
    expect(acc.n).toBe(1);
    expect(acc.aT).toBe(Date.UTC(2026, 1, 1));
  });

  it("no-ops with an empty vPointsMap", async () => {
    const getKlines = vi.fn(async () => []);
    const context = contextWith({ getKlines, symbols: [] });
    await indicators.feed.update(context);
    expect(getKlines).not.toHaveBeenCalled();
  });
});

describe("indicators.feed.update — configured instances", () => {
  const supertrend15: FeatureIndicatorConfig = {
    atrLength: 2,
    factor: 3,
    id: "st15",
    interval: "15m",
    type: "supertrend",
  };

  it("aggregates 5m base candles into closed 15m candles for a Supertrend", async () => {
    const getKlines = vi.fn(async (params: { startTime: number }) =>
      series(params.startTime, NOW),
    );
    const context = contextWith({ getKlines, indicators: [supertrend15] });

    await indicators.feed.update(context);

    const call = getKlines.mock.calls[0][0] as { interval: string; startTime: number };
    expect(call.interval).toBe("5m");
    // 200-candle minimum warm-up of 15m candles, aligned to 15m.
    expect(call.startTime).toBe(NOW - 200 * 15 * MINUTE_MS);
    const acc = context.state.features!.acc!["st:15m:2:3"].SUI as SupertrendAccumulator;
    expect(acc.n).toBe(200);
    expect(acc.t).toBe(NOW - 15 * MINUTE_MS);
  });

  it("skips the read entirely until a new candle of the interval can have closed", async () => {
    const getKlines = vi.fn(async (params: { startTime: number }) =>
      series(params.startTime, NOW),
    );
    const context = contextWith({ getKlines, indicators: [supertrend15] });
    await indicators.feed.update(context);
    context.state.currentTime = NOW + 5 * MINUTE_MS;
    await indicators.feed.update(context);
    expect(getKlines).toHaveBeenCalledTimes(1);
  });

  it("switches the base read to 1m when an instance needs 1m candles", async () => {
    const getKlines = vi.fn(async () => []);
    const context = contextWith({
      getKlines,
      indicators: [{ anchor: "session", id: "vw1", interval: "1m", type: "vwap" }],
    });
    await indicators.feed.update(context);
    expect(getKlines).toHaveBeenCalledWith(expect.objectContaining({ interval: "1m" }));
  });

  it("keeps running state across an id rename and drops unconfigured state", async () => {
    const getKlines = vi.fn(async () => [kline(NOW - CANDLE_MS)]);
    const context = contextWith({ getKlines });
    await indicators.feed.update(context);
    const before = vwapAcc(context);

    context.state.config.management.indicators = [
      { anchor: "month", id: "renamed", interval: "5m", type: "vwap" },
    ];
    await indicators.feed.update(context);
    expect(vwapAcc(context)).toBe(before);

    context.state.config.management.indicators = [supertrend15];
    await indicators.feed.update(context);
    expect(Object.keys(context.state.features!.acc!)).toEqual(["st:15m:2:3"]);
  });
});

describe("indicators.candles.aggregate", () => {
  const BUCKET = 15 * MINUTE_MS;

  it("emits complete buckets and holds back the one still forming", () => {
    const start = NOW - 2 * BUCKET;
    const klines = series(start, NOW - CANDLE_MS);
    const candles = indicators.candles.aggregate(klines, {
      baseMs: CANDLE_MS,
      fromMs: start,
      intervalMs: BUCKET,
      nowMs: NOW - CANDLE_MS + 1,
    });
    expect(candles.map((candle) => candle.t)).toEqual([start]);
    expect(candles[0].volume).toBe(3);
  });

  it("holds a closed bucket missing its last base candle, then folds it once the gap is stale", () => {
    const start = NOW - BUCKET;
    const klines = [kline(start), kline(start + CANDLE_MS)];
    const options = { baseMs: CANDLE_MS, fromMs: start, intervalMs: BUCKET };
    expect(indicators.candles.aggregate(klines, { ...options, nowMs: NOW })).toEqual([]);
    expect(
      indicators.candles.aggregate(klines, { ...options, nowMs: NOW + 2 * CANDLE_MS }),
    ).toHaveLength(1);
  });
});

describe("indicators.math.supertrend", () => {
  const params = { atrLength: 2, factor: 1 };
  const candle = (t: number, high: number, low: number, close: number) => ({
    close,
    high,
    low,
    t,
    volume: 1,
  });

  it("seeds RMA ATR, ratchets the bands, and flips on band crosses", () => {
    const acc = indicators.math.supertrend.accumulator.create();
    const fold = (c: ReturnType<typeof candle>) =>
      indicators.math.supertrend.accumulator.fold(acc, c, params);

    fold(candle(1, 11, 9, 10));
    expect(indicators.math.supertrend.derive(acc, params)).toBeUndefined();

    // First ATR (2): downtrend until the previous candle had an ATR.
    fold(candle(2, 12, 10, 11));
    expect(indicators.math.supertrend.derive(acc, params)).toEqual({ d: -1, l: 13 });

    // ATR 3; close 14.5 > upper 13 → uptrend on the lower band (11).
    fold(candle(3, 15, 13, 14.5));
    expect(indicators.math.supertrend.derive(acc, params, 12)).toEqual({
      d: 1,
      dPct: 9.1,
      fT: 3,
      l: 11,
    });

    // Lower band only rises: basic 10.25 < 11 keeps 11; trend holds.
    fold(candle(4, 14, 12, 12.5));
    expect(indicators.math.supertrend.derive(acc, params)).toMatchObject({ d: 1, l: 11 });

    // Close 9 < lower 11 → downtrend on the (falling) upper band 13.125.
    fold(candle(5, 11, 8, 9));
    expect(indicators.math.supertrend.derive(acc, params)).toEqual({
      d: -1,
      fT: 5,
      l: 13.125,
    });
  });
});

describe("indicators.math.ema", () => {
  const close = (t: number, price: number) => ({ close: price, high: price + 2, low: price - 2, t, volume: 1 });

  it("seeds with the first source value, then folds α = 2 / (length + 1)", () => {
    const params = { length: 3, source: "close" as const };
    const acc = indicators.math.ema.accumulator.create();
    const fold = (t: number, price: number) =>
      indicators.math.ema.accumulator.fold(acc, close(t, price), params);

    fold(1, 10);
    fold(2, 12);
    // Warm-up: no reading until `length` candles folded.
    expect(indicators.math.ema.derive(acc, params)).toBeUndefined();

    fold(3, 14); // α 0.5: 10 → 11 → 12.5
    expect(indicators.math.ema.derive(acc, params, 13)).toEqual({ dPct: 4, sPct: 13.64, v: 12.5 });

    fold(4, 10); // 12.5 → 11.25
    expect(indicators.math.ema.derive(acc, params)).toEqual({ sPct: -10, v: 11.25 });
  });

  it("reads the configured source price", () => {
    const candle = { close: 10, high: 14, low: 8, t: 1, volume: 1 };
    expect(indicators.math.ema.sourcePrice(candle, "close")).toBe(10);
    expect(indicators.math.ema.sourcePrice(candle, "hl2")).toBe(11);
    expect(indicators.math.ema.sourcePrice(candle, "hlc3")).toBeCloseTo(32 / 3);
  });

  it("folds a 1h EMA from 5m base candles in the feed", async () => {
    const getKlines = vi.fn(async (params: { startTime: number }) =>
      series(params.startTime, NOW),
    );
    const context = contextWith({
      getKlines,
      indicators: [{ id: "ema50", interval: "1h", length: 50, source: "close", type: "ema" }],
    });
    await indicators.feed.update(context);
    expect(getKlines).toHaveBeenCalledWith(expect.objectContaining({ interval: "5m" }));
    const acc = context.state.features!.acc!["ema:1h:50:close"].SUI as { n: number; e: number };
    // max(200, 5 × 50) = 250 hourly candles of warm-up.
    expect(acc.n).toBe(250);
    expect(acc.e).toBe(10);
  });
});

describe("indicators.config", () => {
  it("defaults to the gates' monthly 5m VWAP and keeps an explicit empty list", () => {
    expect(indicators.config.normalize(undefined)).toEqual([
      { anchor: "month", id: "vwap", interval: "5m", type: "vwap" },
    ]);
    expect(indicators.config.normalize([])).toEqual([]);
  });

  it("drops invalid entries and duplicate ids", () => {
    expect(
      indicators.config.normalize([
        { atrLength: 10, factor: 3, id: "st1", interval: "15m", type: "supertrend" },
        { atrLength: 10, factor: 3, id: "st1", interval: "1h", type: "supertrend" },
        { atrLength: 0, factor: 3, id: "st2", interval: "1h", type: "supertrend" },
        { anchor: "month", id: "1bad", interval: "5m", type: "vwap" },
        { anchor: "year", id: "vw", interval: "5m", type: "vwap" },
        { id: "ema1", interval: "1h", length: 50.4, source: "close", type: "ema" },
        { id: "ema2", interval: "1h", length: 50, source: "open", type: "ema" },
      ]).map((item) => item.id),
    ).toEqual(["st1", "ema1"]);
  });

  it("resolves only enabled instances, memoized per array", () => {
    const raw: FeatureIndicatorConfig[] = [
      { anchor: "month", id: "vwap", interval: "5m", type: "vwap" },
      { atrLength: 10, factor: 3, id: "st1", interval: "15m", on: false, type: "supertrend" },
    ];
    const resolved = indicators.config.resolve(raw);
    expect(resolved.map((item) => item.id)).toEqual(["vwap"]);
    expect(indicators.config.resolve(raw)).toBe(resolved);
  });
});

describe("management.indicators persistence", () => {
  const list: FeatureIndicatorConfig[] = [
    { atrLength: 10, factor: 3, id: "st1", interval: "1h", type: "supertrend" },
  ];

  it("survives the settings draft", () => {
    const draft = makeConfigDraft({
      accounts: [],
      config: { indicators: list, symbols: ["SUI"] },
      runtime: {},
    } as never);
    expect(draft.management.indicators).toEqual(list);
  });

  it("survives the shared-management save split", () => {
    const management = runtimeAccountConfig.shared.fromEffective(
      runtimeDefaults.management.create(),
      { ...runtimeDefaults.management.create(), indicators: list } as never,
    );
    expect(management.indicators).toEqual(list);
  });
});
