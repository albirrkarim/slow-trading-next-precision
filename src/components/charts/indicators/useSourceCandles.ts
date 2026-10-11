"use client";

import axios from "axios";
import { useEffect, useMemo, useState } from "react";

import { endpoints } from "@/components/endpoints";
import type { FeatureIndicatorInterval } from "@/lib/features/indicators";
import { systemLog } from "@/lib/system/logging";
import type { VwapCandle } from "@/lib/system/utils/ui/chart-vwap";

/** One indicator's need: closed `interval` candles from `startTime`. */
export interface SourceCandleRequest {
  interval: FeatureIndicatorInterval;
  startTime: number;
}

export type SourceCandles = Partial<Record<FeatureIndicatorInterval, VwapCandle[]>>;

/**
 * Fetches the closed candles runtime-faithful indicator overlays fold —
 * one request per interval, starting at the earliest start any overlay of
 * that interval needs (anchor start or warm-up) through `endTime`. An
 * interval is absent from the result while loading or after a failure.
 */
export function useSourceCandles({
  requests,
  symbol,
  exchange,
  marketType,
  endTime,
}: {
  requests: SourceCandleRequest[];
  symbol: string;
  exchange: string;
  marketType?: "SPOT" | "FUTURES";
  /** Last chart candle close (ms). */
  endTime?: number;
}): { candles: SourceCandles; loading: boolean } {
  // Callers rebuild `requests` every render — plan on its content so the
  // fetch effect only reruns when the needed candles actually change.
  const requestKey = JSON.stringify(requests);
  const plan = useMemo(() => {
    const starts = new Map<FeatureIndicatorInterval, number>();
    for (const request of JSON.parse(requestKey) as SourceCandleRequest[]) {
      const current = starts.get(request.interval);
      if (current === undefined || request.startTime < current) {
        starts.set(request.interval, request.startTime);
      }
    }
    return [...starts].map(([interval, startTime]) => ({
      interval,
      startTime,
      key: `${exchange}:${marketType}:${symbol}:${interval}:${startTime}:${endTime}`,
    }));
  }, [endTime, exchange, marketType, requestKey, symbol]);

  const [loaded, setLoaded] = useState<Record<string, VwapCandle[]>>({});

  useEffect(() => {
    if (endTime === undefined) return () => {};
    const controller = new AbortController();
    for (const item of plan) {
      if (loaded[item.key] || item.startTime >= endTime) continue;
      axios
        .get<{ klines: any[] }>(endpoints.market.klines, {
          params: {
            symbol,
            interval: item.interval,
            exchange: exchange || "okx",
            marketType: marketType || "FUTURES",
            startTime: Math.round(item.startTime),
            endTime: Math.round(endTime),
            volatility: false,
          },
          signal: controller.signal,
        })
        .then((res) => {
          const candles = (res.data.klines ?? []).map((k: any[]) => ({
            time: k[0] / 1000,
            high: Number(k[2]),
            low: Number(k[3]),
            close: Number(k[4]),
            volume: Number(k[5]),
          }));
          setLoaded((prev) => ({ ...prev, [item.key]: candles }));
        })
        .catch((error) => {
          if (axios.isCancel(error)) return;
          systemLog.error("Failed to fetch indicator source klines", error);
        });
    }
    return () => controller.abort();
    // `loaded` is read only to skip finished keys; refetching on its change
    // would abort the in-flight siblings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endTime, exchange, marketType, plan, symbol]);

  return useMemo(() => {
    const candles: SourceCandles = {};
    for (const item of plan) {
      if (loaded[item.key]) candles[item.interval] = loaded[item.key];
    }
    return { candles, loading: plan.some((item) => !loaded[item.key]) };
  }, [loaded, plan]);
}
