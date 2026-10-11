"use client";

import axios from "axios";
import { useEffect, useState } from "react";

import { endpoints } from "@/components/endpoints";
import vwapFeature from "@/lib/features/vwap";
import { systemLog } from "@/lib/system/logging";
import type { VwapCandle } from "@/lib/system/utils/ui/vwap";

/**
 * Fetches the runtime gate's own VWAP candles (closed 5m klines from the
 * UTC month start of the chart's first candle through its last close), so
 * "match gate" VWAP instances fold exactly what the feature feed folded.
 * Returns undefined while disabled, loading, or failed.
 */
export function useGateVwapCandles({
  enabled,
  symbol,
  exchange,
  marketType,
  fromMs,
  toMs,
}: {
  enabled: boolean;
  symbol: string;
  exchange: string;
  marketType?: "SPOT" | "FUTURES";
  /** First chart candle open (ms) — the fetch starts at its month start. */
  fromMs?: number;
  /** Last chart candle close (ms). */
  toMs?: number;
}): VwapCandle[] | undefined {
  const [result, setResult] = useState<{
    key: string;
    candles: VwapCandle[];
  }>();

  const startTime =
    fromMs !== undefined ? vwapFeature.monthStartMs(fromMs) : undefined;
  const key = `${exchange}:${marketType}:${symbol}:${startTime}:${toMs}`;
  const active =
    enabled &&
    startTime !== undefined &&
    toMs !== undefined &&
    toMs > startTime;

  useEffect(() => {
    if (!active || result?.key === key) return () => {};
    const controller = new AbortController();
    axios
      .get<{ klines: any[] }>(endpoints.market.klines, {
        params: {
          symbol,
          interval: vwapFeature.INTERVAL,
          exchange: exchange || "okx",
          marketType: marketType || "FUTURES",
          startTime: Math.round(startTime as number),
          endTime: Math.round(toMs as number),
          volatility: false,
        },
        signal: controller.signal,
      })
      .then((res) =>
        setResult({
          key,
          candles: (res.data.klines ?? []).map((k: any[]) => ({
            time: k[0] / 1000,
            high: Number(k[2]),
            low: Number(k[3]),
            close: Number(k[4]),
            volume: Number(k[5]),
          })),
        }),
      )
      .catch((error) => {
        if (axios.isCancel(error)) return;
        systemLog.error("Failed to fetch gate VWAP klines", error);
      });
    return () => controller.abort();
  }, [active, exchange, key, marketType, result?.key, startTime, symbol, toMs]);

  return active && result?.key === key ? result.candles : undefined;
}
