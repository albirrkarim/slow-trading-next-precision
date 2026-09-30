import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  root: `/tmp/prod-black-swan-timeline-${process.pid}`,
}));

vi.mock("@/lib/system/storage/root", () => ({
  default: { resolve: () => mocks.root },
}));

import type {
  RuntimeContext,
  RuntimeEngineAdapter,
  RuntimeEngineState,
} from "@/lib/precision/types";
import productionStages from "@/lib/production/stages";
import { runtimeStorage } from "@/lib/system/storage";
import { systemNotif } from "@/lib/system/notification";
import type { Kline } from "@/lib/system/types";
import { DEFAULT_BLACK_SWAN_CONFIG } from "@/lib/system/trading/black-swan";

const MINUTE_MS = 60_000;
const NOW = Date.UTC(2026, 8, 3, 10, 4);

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

function crashCandles(endTime: number): Kline[] {
  const latestOpen = Math.floor(endTime / MINUTE_MS) * MINUTE_MS - MINUTE_MS;
  const candles: Kline[] = [];
  for (
    let open = latestOpen - 64 * MINUTE_MS;
    open <= latestOpen;
    open += MINUTE_MS
  ) {
    candles.push(
      candle(open, open > latestOpen - 3 * MINUTE_MS ? 90 : 100),
    );
  }
  return candles;
}

function contextWith(mode: "live" | "sandbox", currentTime: number) {
  const state = {
    config: {
      accounts: [],
      management: {
        blackSwan: { ...DEFAULT_BLACK_SWAN_CONFIG, enabled: true },
        exchangeType: "binance",
        symbols: ["SUI"],
        tradingMode: "futures",
      },
      runtime: {
        notification: {
          email: { enabled: false, types: [] },
          telegram: { enabled: false, types: [] },
        },
      },
    },
    currentTime,
    mode,
    openPositions: [],
  } as unknown as RuntimeEngineState;
  const adapter = {
    market: {
      getKlines: vi.fn(async ({ symbol }: { symbol: string }) =>
        symbol === "BTC_USDT" ? crashCandles(currentTime) : [],
      ),
    },
  } as unknown as RuntimeEngineAdapter;
  return {
    adapter,
    context: { adapter, helper: {}, state } as RuntimeContext,
    state,
  };
}

describe("production risk-sentinel persisted timeline", () => {
  beforeEach(async () => {
    vi.spyOn(systemNotif, "central").mockResolvedValue(true);
    await fs.remove(mocks.root);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.remove(mocks.root);
  });

  it("writes transitions into status.json per mode without touching the other slice", async () => {
    const { context } = contextWith("live", NOW);
    await productionStages.riskSentinel(context);

    const live = await runtimeStorage.status.load("live");
    expect(live.blackSwan?.status).toBe("CRISIS");
    expect(live.blackSwanTimeline).toEqual({
      enabled: true,
      endTime: NOW,
      segments: [{ enabled: true, status: "CRISIS", t: NOW }],
      startTime: NOW,
    });
    expect(await runtimeStorage.status.load("sandbox")).toEqual({});
    expect(systemNotif.central).not.toHaveBeenCalled();

    const sandbox = contextWith("sandbox", NOW + MINUTE_MS);
    await productionStages.riskSentinel(sandbox.context);
    const sandboxStatus = await runtimeStorage.status.load("sandbox");
    expect(sandboxStatus.blackSwanTimeline?.segments).toEqual([
      { enabled: true, status: "CRISIS", t: NOW + MINUTE_MS },
    ]);
    const liveAfter = await runtimeStorage.status.load("live");
    expect(liveAfter.blackSwanTimeline?.endTime).toBe(NOW);
  });

  it("extends endTime on repeat, appends on change, and survives reload", async () => {
    const { adapter, context, state } = contextWith("live", NOW);
    await productionStages.riskSentinel(context);

    adapter.market.getKlines = vi.fn(async () => crashCandles(NOW + MINUTE_MS));
    state.currentTime = NOW + MINUTE_MS;
    await productionStages.riskSentinel(context);

    let status = await runtimeStorage.status.load("live");
    expect(status.blackSwanTimeline?.segments).toHaveLength(1);
    expect(status.blackSwanTimeline?.endTime).toBe(NOW + MINUTE_MS);

    adapter.market.getKlines = vi.fn(async ({ symbol }: { symbol: string }) =>
      symbol === "BTC_USDT"
        ? crashCandles(NOW + 2 * MINUTE_MS).map(
            (kline) =>
              [
                kline[0],
                kline[1],
                kline[2],
                kline[3],
                "100",
                kline[5],
                kline[6],
              ] as unknown as Kline,
          )
        : [],
    );
    state.currentTime = NOW + 2 * MINUTE_MS;
    await productionStages.riskSentinel(context);

    status = await runtimeStorage.status.load("live");
    expect(status.blackSwanTimeline?.segments).toEqual([
      { enabled: true, status: "CRISIS", t: NOW },
      { enabled: true, status: "RECOVERY", t: NOW + 2 * MINUTE_MS },
    ]);
    expect(status.blackSwanTimeline?.endTime).toBe(NOW + 2 * MINUTE_MS);
    expect(systemNotif.central).not.toHaveBeenCalled();
  });
});
