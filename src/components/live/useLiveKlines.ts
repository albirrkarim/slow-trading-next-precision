"use client";

import axios from "axios";
import { useCallback, useEffect, useRef, useState } from "react";

import type { CandlePoint } from "@/components/charts/CurrencyChart/types";
import { endpoints } from "@/components/endpoints";
import type { IntervalKlines } from "@/lib/exchange";
import { systemLog } from "@/lib/system/logging";
import type { VolatilityPoint } from "@/lib/system/types/market";

import binanceLiveSocket, { type LiveMarket } from "./binanceLiveSocket";

/** Candles per history request — one Binance REST page. */
const CHUNK_BARS = 1000;
/** Gap-fill + new-vPoint refresh cadence. */
const REFRESH_MS = 60_000;
/** Live ticks are batched into React state at most this often. */
const FLUSH_MS = 500;

const INTERVAL_MS: Record<string, number> = {
  "1m": 60_000,
  "3m": 3 * 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1h": 60 * 60_000,
  "2h": 2 * 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};

export type LiveStatus = "connecting" | "live" | "reconnecting";

interface HistoryChunk {
  candles: CandlePoint[];
  /** Stored engine vPoints inside the chunk's window. */
  points: VolatilityPoint[];
}

/** Merges candle lists by open time (later wins), sorted ascending. */
function mergeCandles(base: CandlePoint[], incoming: CandlePoint[]): CandlePoint[] {
  if (incoming.length === 0) return base;
  const byTime = new Map<number, CandlePoint>();
  for (const candle of base) byTime.set(candle.time, candle);
  for (const candle of incoming) byTime.set(candle.time, candle);
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/** Merges vPoint lists by id (later wins), sorted by time. */
function mergePoints(base: VolatilityPoint[], incoming: VolatilityPoint[]): VolatilityPoint[] {
  if (incoming.length === 0) return base;
  const byId = new Map<string, VolatilityPoint>();
  for (const point of [...base, ...incoming]) byId.set(point.id, point);
  return [...byId.values()].sort((a, b) => a.t - b.t);
}

/** Fetches closed candles (+ stored vPoints) for `[startMs, endMs]`. */
async function fetchHistory(params: {
  symbol: string;
  interval: IntervalKlines;
  market: LiveMarket;
  startMs: number;
  endMs: number;
  signal?: AbortSignal;
}): Promise<HistoryChunk> {
  const res = await axios.get<{ klines: any[]; vPoints?: VolatilityPoint[] }>(endpoints.market.klines, {
    params: {
      endTime: Math.round(params.endMs),
      exchange: "binance",
      interval: params.interval,
      marketType: params.market,
      startTime: Math.round(params.startMs),
      symbol: params.symbol,
      volatility: true,
      volatilitySource: "storage",
    },
    signal: params.signal,
  });
  return {
    candles: (res.data.klines ?? []).map((k: any[]) => ({
      close: Number(k[4]),
      high: Number(k[2]),
      low: Number(k[3]),
      open: Number(k[1]),
      time: k[0] / 1000,
      volume: Number(k[5]),
    })),
    points: res.data.vPoints ?? [],
  };
}

/**
 * Live candles for one coin/interval: the latest `CHUNK_BARS` closed
 * candles, older chunks on demand (`loadOlder`, scroll-back), the forming
 * candle streamed from Binance's public websocket, and a periodic refresh
 * that patches gaps (reconnects, sleep) and picks up new stored vPoints.
 */
export function useLiveKlines({
  symbol,
  interval,
  market,
}: {
  symbol: string;
  interval: IntervalKlines;
  market: LiveMarket;
}) {
  const [candles, setCandles] = useState<CandlePoint[]>([]);
  const [points, setPoints] = useState<VolatilityPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [reachedStart, setReachedStart] = useState(false);
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const candlesRef = useRef<CandlePoint[]>([]);
  const olderInFlight = useRef(false);
  const intervalMs = INTERVAL_MS[interval] ?? 60_000;

  useEffect(() => {
    candlesRef.current = candles;
  }, [candles]);

  // Initial history + live stream + periodic refresh, per coin/interval.
  useEffect(() => {
    const controller = new AbortController();
    // Fresh state per coin/interval comes from the owner remounting this
    // hook (keyed component) — no synchronous resets here.
    let pending: CandlePoint | undefined;

    const loadRecent = (bars: number) => {
      const now = Date.now();
      return fetchHistory({
        endMs: now,
        interval,
        market,
        signal: controller.signal,
        startMs: now - bars * intervalMs,
        symbol,
      });
    };

    loadRecent(CHUNK_BARS)
      .then((chunk) => {
        setCandles((current) => mergeCandles(chunk.candles, current));
        setPoints(chunk.points);
        if (chunk.candles.length === 0) setReachedStart(true);
      })
      .catch((requestError) => {
        if (axios.isCancel(requestError)) return;
        systemLog.error("Failed to load live chart history", requestError);
        setError("Failed to load candles");
      })
      .finally(() => setLoading(false));

    const refresh = () =>
      loadRecent(100)
        .then((chunk) => {
          setCandles((current) => (current.length ? mergeCandles(current, chunk.candles) : current));
          setPoints((current) => mergePoints(current, chunk.points));
        })
        .catch((requestError) => {
          if (!axios.isCancel(requestError)) systemLog.error("Live chart refresh failed", requestError);
        });

    const socket = binanceLiveSocket.open({
      interval,
      market,
      onCandle: (candle) => {
        pending = candle;
      },
      onStatus: (next) => {
        setStatus(next);
        // A reconnect may have skipped closed candles — patch them now.
        if (next === "live") void refresh();
      },
      symbol,
    });
    const flush = setInterval(() => {
      if (!pending) return;
      const candle = pending;
      pending = undefined;
      setCandles((current) => {
        const last = current.at(-1);
        if (!last || candle.time > last.time) return [...current, candle];
        if (candle.time === last.time) return [...current.slice(0, -1), candle];
        return current;
      });
    }, FLUSH_MS);
    const refreshTimer = setInterval(() => void refresh(), REFRESH_MS);

    return () => {
      controller.abort();
      socket.close();
      clearInterval(flush);
      clearInterval(refreshTimer);
    };
  }, [interval, intervalMs, market, symbol]);

  /** Prepends the next older chunk; no-op while one is loading or at the start of history. */
  const loadOlder = useCallback(() => {
    const first = candlesRef.current[0];
    if (!first || olderInFlight.current || reachedStart) return;
    olderInFlight.current = true;
    setLoadingOlder(true);
    const endMs = first.time * 1000 - 1;
    fetchHistory({
      endMs,
      interval,
      market,
      startMs: endMs - CHUNK_BARS * intervalMs,
      symbol,
    })
      .then((chunk) => {
        if (chunk.candles.length === 0) {
          setReachedStart(true);
          return;
        }
        setCandles((current) => mergeCandles(current, chunk.candles));
        setPoints((current) => mergePoints(current, chunk.points));
      })
      .catch((requestError) => systemLog.error("Failed to load older candles", requestError))
      .finally(() => {
        olderInFlight.current = false;
        setLoadingOlder(false);
      });
  }, [interval, intervalMs, market, reachedStart, symbol]);

  return { candles, error, intervalMs, loadOlder, loading, loadingOlder, points, reachedStart, status };
}

export const LIVE_INTERVALS = Object.keys(INTERVAL_MS) as IntervalKlines[];
