"use client";

import type { CandlePoint } from "@/components/charts/CurrencyChart/types";

export type LiveMarket = "FUTURES" | "SPOT";

/**
 * Binance public market-data stream bases — the same hosts the server's
 * kline stream uses (`exchange/platform/binance/kline-stream.ts`): futures
 * only streams from the `/market` base; the legacy futures `/stream` root
 * ACKs subscriptions but never delivers.
 */
const HOSTS: Record<LiveMarket, string> = {
  FUTURES: "wss://fstream.binance.com/market/stream",
  SPOT: "wss://stream.binance.com:9443/stream",
};

const RECONNECT_MS = 3_000;
/** No event for this long on an open socket → treat it as dead and reconnect. */
const STALE_MS = 30_000;

/** Kline stream event → chart candle (time in seconds). */
function toCandle(payload: any): CandlePoint | undefined {
  const k = payload?.data?.k;
  if (!k) return undefined;
  const time = Number(k.t) / 1000;
  if (!Number.isFinite(time)) return undefined;
  return {
    close: Number(k.c),
    high: Number(k.h),
    low: Number(k.l),
    open: Number(k.o),
    time,
    volume: Number(k.v),
  };
}

/**
 * Opens a browser websocket streaming one coin's klines (forming and
 * closing candles alike), reconnecting until `close()`. `onStatus` fires
 * only on changes: "live" at the first event of each connection,
 * "reconnecting" when it drops.
 */
function open({
  symbol,
  interval,
  market,
  onCandle,
  onStatus,
}: {
  symbol: string;
  interval: string;
  market: LiveMarket;
  onCandle: (candle: CandlePoint) => void;
  onStatus: (status: "live" | "reconnecting") => void;
}): { close: () => void } {
  const stream = `${symbol.toLowerCase().replace(/_?usdt$/i, "")}usdt@kline_${interval}`;
  let socket: WebSocket | undefined;
  let closed = false;
  let live = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let staleTimer: ReturnType<typeof setTimeout> | undefined;

  const armStale = () => {
    clearTimeout(staleTimer);
    staleTimer = setTimeout(() => socket?.close(), STALE_MS);
  };

  const connect = () => {
    if (closed) return;
    socket = new WebSocket(HOSTS[market]);
    socket.onopen = () => {
      socket?.send(JSON.stringify({ id: 1, method: "SUBSCRIBE", params: [stream] }));
      armStale();
    };
    socket.onmessage = (event) => {
      let payload: unknown;
      try {
        payload = JSON.parse(String(event.data));
      } catch {
        return;
      }
      const candle = toCandle(payload);
      if (!candle) return;
      armStale();
      if (!live) {
        live = true;
        onStatus("live");
      }
      onCandle(candle);
    };
    socket.onclose = () => {
      clearTimeout(staleTimer);
      live = false;
      if (closed) return;
      onStatus("reconnecting");
      reconnectTimer = setTimeout(connect, RECONNECT_MS);
    };
    socket.onerror = () => socket?.close();
  };

  connect();
  return {
    close: () => {
      closed = true;
      clearTimeout(reconnectTimer);
      clearTimeout(staleTimer);
      socket?.close();
    },
  };
}

const binanceLiveSocket = { open } as const;

export default binanceLiveSocket;
