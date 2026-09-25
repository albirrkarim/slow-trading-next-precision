import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  error: vi.fn(),
}));

vi.mock("@/lib/system/logging", () => ({
  systemLog: { error: mocks.error },
}));

import binanceKlineStream, {
  type BinanceKlineStreamSocket,
} from "@/lib/exchange/platform/binance/kline-stream";

class FakeSocket implements BinanceKlineStreamSocket {
  closed = false;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event?: { code?: number }) => void) | null = null;
  onerror: ((event?: unknown) => void) | null = null;

  close() {
    this.closed = true;
    this.onclose?.({ code: 1000 });
  }
  send(data: string) {
    this.sent.push(data);
  }
  open() {
    this.onopen?.();
  }
  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
  frames() {
    return this.sent.map((frame) => JSON.parse(frame));
  }
}

function klineEvent(
  streamSymbol: string,
  interval: string,
  params: { c: string; t: number; T: number; x: boolean },
) {
  return {
    stream: `${streamSymbol}@kline_${interval}`,
    data: {
      e: "kline",
      E: Date.now(),
      s: streamSymbol.toUpperCase(),
      k: {
        B: "0",
        Q: "5",
        T: params.T,
        V: "5",
        c: params.c,
        h: "2",
        i: interval,
        l: "0.5",
        n: 5,
        o: "1",
        q: "10",
        t: params.t,
        v: "10",
        x: params.x,
      },
    },
  };
}

describe("Binance kline stream", () => {
  let sockets: FakeSocket[];
  let feed: ReturnType<typeof binanceKlineStream.create>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 8, 24, 12));
    vi.clearAllMocks();
    sockets = [];
    feed = binanceKlineStream.create({
      marketType: "FUTURES",
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    });
  });

  afterEach(() => {
    feed.stop();
    vi.useRealTimers();
  });

  function emit(
    streamSymbol: string,
    interval: string,
    params: { c: string; t: number; T: number; x: boolean },
  ) {
    sockets.at(-1)?.emit(klineEvent(streamSymbol, interval, params));
  }

  it("subscribes the tracked kline streams once the socket opens", () => {
    feed.track(["SUI", "BTC"], "5m");
    expect(sockets).toHaveLength(1);

    sockets[0].open();
    expect(sockets[0].frames()).toContainEqual({
      id: expect.any(Number),
      method: "SUBSCRIBE",
      params: ["suiusdt@kline_5m", "btcusdt@kline_5m"],
    });
  });

  it("serves mark prices from the forming candle and closed klines from the buffer", () => {
    feed.track(["SUI"], "5m");
    sockets[0].open();
    emit("suiusdt", "5m", { c: "100", t: 1_000, T: 2_000, x: true });
    emit("suiusdt", "5m", { c: "101.5", t: 3_000, T: 4_000, x: false });

    // PROD:MARKET_LIVE_FEED
    expect(feed.markPrice("SUI", "5m")).toEqual({
      lastUpdated: Date.now(),
      price: 101.5,
    });
    // sinceOpenTime matches the oldest buffered candle → fully covered.
    expect(feed.closedKlines("SUI", "5m", 1_000)).toEqual([
      [1_000, "1", "2", "0.5", "100", "10", 2_000, "10", 5, "5", "5", "0", ""],
    ]);
  });

  it("returns undefined for windows the buffer cannot cover", () => {
    feed.track(["SUI"], "5m");
    sockets[0].open();
    emit("suiusdt", "5m", { c: "100", t: 1_000, T: 2_000, x: true });

    // PROD:MARKET_LIVE_FEED — a window starting before the first buffered
    // candle must backfill through REST instead of silently truncating.
    expect(feed.closedKlines("SUI", "5m", 500)).toBeUndefined();
    expect(feed.closedKlines("SUI", "5m", 1_000)).toHaveLength(1);
    expect(feed.closedKlines("SUI", "5m", 3_000)).toEqual([]);
  });

  it("stops serving data when the stream goes quiet", () => {
    feed.track(["SUI"], "5m");
    sockets[0].open();
    emit("suiusdt", "5m", { c: "100", t: 1_000, T: 2_000, x: true });

    vi.setSystemTime(Date.now() + 31_000);
    expect(feed.markPrice("SUI", "5m")).toBeUndefined();
    expect(feed.closedKlines("SUI", "5m", 0)).toBeUndefined();
  });

  it("reconnects and resubscribes after the socket closes", async () => {
    feed.track(["SUI"], "5m");
    sockets[0].open();
    sockets[0].close();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(sockets).toHaveLength(2);
    sockets[1].open();
    expect(sockets[1].frames()).toContainEqual({
      id: expect.any(Number),
      method: "SUBSCRIBE",
      params: ["suiusdt@kline_5m"],
    });
  });

  it("prunes streams that stop being requested", () => {
    feed.track(["SUI"], "5m");
    sockets[0].open();

    // Keep the feed alive while SUI goes unrequested.
    vi.setSystemTime(Date.now() + 10 * 60_000);
    feed.track(["BTC"], "5m");
    vi.setSystemTime(Date.now() + 6 * 60_000);
    feed.track(["BTC"], "5m");

    expect(sockets[0].frames()).toContainEqual({
      id: expect.any(Number),
      method: "UNSUBSCRIBE",
      params: ["suiusdt@kline_5m"],
    });
    expect(sockets[0].frames()).toContainEqual({
      id: expect.any(Number),
      method: "SUBSCRIBE",
      params: ["btcusdt@kline_5m"],
    });
  });

  it("idle-closes the socket when nothing tracks it, then reconnects on demand", async () => {
    feed.track(["SUI"], "5m");
    sockets[0].open();

    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(sockets[0].closed).toBe(true);

    feed.track(["BTC"], "5m");
    expect(sockets).toHaveLength(2);
    sockets[1].open();
    expect(sockets[1].frames()).toContainEqual({
      id: expect.any(Number),
      method: "SUBSCRIBE",
      params: ["btcusdt@kline_5m"],
    });
  });
});
