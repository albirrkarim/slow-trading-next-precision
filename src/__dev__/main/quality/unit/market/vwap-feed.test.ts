import { describe, expect, it, vi } from "vitest";

import vwapFeed from "@/lib/features/vwap-feed";
import type { RuntimeContext } from "@/lib/precision/types";
import type { Kline } from "@/lib/system/types/market";

const CANDLE_MS = 5 * 60_000;
const NOW = Date.UTC(2026, 0, 15, 12, 0);

function kline(openTime: number, price = 10, volume = 1): Kline {
  return [
    openTime,
    String(price),
    String(price),
    String(price),
    String(price),
    String(volume),
    openTime + CANDLE_MS - 1,
  ] as unknown as Kline;
}

function contextWith(params: {
  closedKlines?: ReturnType<typeof vi.fn>;
  getKlines?: ReturnType<typeof vi.fn>;
  now?: number;
  symbols?: string[];
}): RuntimeContext {
  return {
    adapter: {
      market: {
        getKlines: params.getKlines ?? vi.fn(async () => []),
        live: params.closedKlines
          ? {
              closedKlines: params.closedKlines,
              track: vi.fn(),
            }
          : undefined,
      },
    },
    state: {
      config: { management: { tradingMode: "futures" } },
      currentTime: params.now ?? NOW,
      vPointsMap: Object.fromEntries(
        (params.symbols ?? ["SUI"]).map((symbol) => [symbol, []]),
      ),
    },
  } as unknown as RuntimeContext;
}

describe("vwapFeed.update", () => {
  it("folds buffer candles into the accumulator without touching REST", async () => {
    const getKlines = vi.fn(async () => []);
    const closedKlines = vi.fn(() => [kline(NOW - CANDLE_MS)]);
    const context = contextWith({ closedKlines, getKlines });

    await vwapFeed.update(context);

    const acc = context.state.features!.vwap!.SUI;
    expect(acc.v).toBe(1);
    expect(acc.t).toBe(NOW - CANDLE_MS);
    expect(getKlines).not.toHaveBeenCalled();
  });

  it("backfills through REST when the live buffer cannot cover the window", async () => {
    const getKlines = vi.fn(async () => [kline(NOW - CANDLE_MS)]);
    const closedKlines = vi.fn(() => undefined);
    const context = contextWith({ closedKlines, getKlines });

    await vwapFeed.update(context);

    expect(getKlines).toHaveBeenCalledWith(
      expect.objectContaining({ interval: "5m", symbol: "SUI_USDT" }),
    );
    expect(context.state.features!.vwap!.SUI.v).toBe(1);
  });

  it("does not refold candles the cursor already consumed", async () => {
    const candle = kline(NOW - CANDLE_MS);
    const context = contextWith({
      getKlines: vi.fn(async () => [candle]),
    });
    await vwapFeed.update(context);
    await vwapFeed.update(context);

    expect(context.state.features!.vwap!.SUI.n).toBe(1);
  });

  it("restarts the accumulator when the month anchor rolls over", async () => {
    const getKlines = vi
      .fn()
      .mockImplementation(async () => [kline(NOW - CANDLE_MS)]);
    const context = contextWith({ getKlines });
    await vwapFeed.update(context);
    expect(context.state.features!.vwap!.SUI.n).toBe(1);

    // February: fresh anchor → sums restart from zero.
    context.state.currentTime = Date.UTC(2026, 1, 1, 12, 0);
    getKlines.mockImplementation(async () => [
      kline(context.state.currentTime - CANDLE_MS),
    ]);
    await vwapFeed.update(context);

    const acc = context.state.features!.vwap!.SUI;
    expect(acc.n).toBe(1);
    expect(acc.aT).toBe(Date.UTC(2026, 1, 1));
  });

  it("no-ops with an empty vPointsMap", async () => {
    const getKlines = vi.fn(async () => []);
    const context = contextWith({ getKlines, symbols: [] });
    await vwapFeed.update(context);
    expect(getKlines).not.toHaveBeenCalled();
  });
});
