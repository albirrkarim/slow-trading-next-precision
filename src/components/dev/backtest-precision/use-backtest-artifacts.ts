"use client";

import axios from "axios";
import { useCallback, useRef, useState } from "react";

import type { BacktestBalanceSnapshot } from "@/lib/dev/backtestPrecision/backtest/backtest-precision-types";
import type { BacktestLeaderboardMetrics } from "@/lib/dev/backtestPrecision/leaderboards";
import type { Position } from "@/lib/system/trading";
import type { VolatilityPoint } from "@/lib/system/types";

import { endpoints } from "../../endpoints";

type ArtifactField = "positions" | "vpoints" | "snapshots" | "metrics";

export interface LazyArtifact<T> {
  data?: T;
  error?: string;
  loading: boolean;
  /**
   * Fetches the field once and caches it; later calls resolve immediately.
   * Returns the in-flight promise when a request is already running.
   */
  ensure: () => Promise<T | undefined>;
}

const responseKey = (field: ArtifactField) =>
  field === "positions"
    ? "positions"
    : field === "vpoints"
      ? "vPointsMap"
      : field === "metrics"
        ? "metrics"
        : "balanceSnapshots";

interface ArtifactEntry<T> {
  key: string;
  value?: T;
  error?: string;
}

function useLazyArtifact<T>(
  cacheKey: string | undefined,
  field: ArtifactField,
): LazyArtifact<T> {
  // Entries carry their key so a result swap just exposes empty state for
  // the new key — no reset effect is needed.
  const [entry, setEntry] = useState<ArtifactEntry<T> | undefined>();
  const [loading, setLoading] = useState(false);
  const inflight = useRef<{ key: string; promise: Promise<T | undefined> } | null>(
    null,
  );

  const isCurrent = entry !== undefined && entry.key === cacheKey;
  const data = isCurrent ? entry.value : undefined;
  const error = isCurrent ? entry.error : undefined;

  const ensure = useCallback((): Promise<T | undefined> => {
    if (!cacheKey) return Promise.resolve(undefined);
    // Resolved entries (value or error) are final for this key — otherwise a
    // failed request would re-trigger the consuming effect on every render.
    if (entry?.key === cacheKey) {
      return Promise.resolve(entry.value);
    }
    if (inflight.current?.key === cacheKey) return inflight.current.promise;

    const promise = axios
      .get<Record<string, unknown>>(endpoints.dev.backtestPrecisionDetail, {
        params: { field, key: cacheKey },
      })
      .then((resp) => {
        const value = resp.data[responseKey(field)] as T;
        setEntry({ key: cacheKey, value });
        return value;
      })
      .catch((requestError: unknown) => {
        setEntry({
          error: axios.isAxiosError(requestError)
            ? ((requestError.response?.data as { error?: string } | undefined)
                ?.error ?? requestError.message)
            : "Failed to load backtest detail",
          key: cacheKey,
        });
        return undefined;
      })
      .finally(() => {
        inflight.current = null;
        setLoading(false);
      });

    inflight.current = { key: cacheKey, promise };
    setLoading(true);
    return promise;
  }, [cacheKey, entry, field]);

  return {
    data,
    error,
    loading: isCurrent ? loading && entry.value === undefined && !entry.error : loading,
    ensure,
  };
}

/**
 * Lazy loaders for the chunked backtest artifacts. Each field resolves via
 * the detail endpoint on first `ensure()` — sections call it when they
 * expand instead of receiving the arrays inside the run response.
 */
export function useBacktestArtifacts(cacheKey?: string) {
  return {
    metrics: useLazyArtifact<BacktestLeaderboardMetrics>(cacheKey, "metrics"),
    positions: useLazyArtifact<Position[]>(cacheKey, "positions"),
    vpoints: useLazyArtifact<Record<string, VolatilityPoint[]>>(
      cacheKey,
      "vpoints",
    ),
    snapshots: useLazyArtifact<Record<string, BacktestBalanceSnapshot[]>>(
      cacheKey,
      "snapshots",
    ),
  };
}
