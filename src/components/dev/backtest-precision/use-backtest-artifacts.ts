"use client";

import axios from "axios";
import { useCallback, useMemo, useRef, useState } from "react";

import type {
  BacktestBalanceSnapshot,
  BacktestFeatureRecord,
} from "@/lib/dev/backtestPrecision/backtest/backtest-precision-types";
import type { BacktestLeaderboardMetrics } from "@/lib/dev/backtestPrecision/leaderboards";
import type { Position } from "@/lib/system/trading";
import type { VolatilityPoint } from "@/lib/system/types";

import { endpoints } from "../../endpoints";

type ArtifactField =
  | "features"
  | "positions"
  | "vpoints"
  | "snapshots"
  | "metrics";

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
        : field === "features"
          ? "featuresMap"
          : "balanceSnapshots";

interface ArtifactEntry<T> {
  key: string;
  value?: T;
  error?: string;
}

function useLazyArtifact<T>(
  cacheKey: string | undefined,
  field: ArtifactField,
  runId: string | undefined,
): LazyArtifact<T> {
  // Entries carry the run identity (`cacheKey@runId`): a result swap exposes
  // empty state for the new identity, and a recompute that reuses the same
  // cacheKey still invalidates entries resolved under the previous runId —
  // requests themselves always address artifacts by the raw cacheKey.
  const entryKey = cacheKey === undefined ? undefined : `${cacheKey}@${runId ?? ""}`;
  const [entry, setEntry] = useState<ArtifactEntry<T> | undefined>();
  const [loading, setLoading] = useState(false);
  const inflight = useRef<{ key: string; promise: Promise<T | undefined> } | null>(
    null,
  );

  const isCurrent = entry !== undefined && entry.key === entryKey;
  const data = isCurrent ? entry.value : undefined;
  const error = isCurrent ? entry.error : undefined;

  const ensure = useCallback((): Promise<T | undefined> => {
    if (!cacheKey || !entryKey) return Promise.resolve(undefined);
    // Resolved entries (value or error) are final for this key — otherwise a
    // failed request would re-trigger the consuming effect on every render.
    if (entry?.key === entryKey) {
      return Promise.resolve(entry.value);
    }
    if (inflight.current?.key === entryKey) return inflight.current.promise;

    const promise = axios
      .get<Record<string, unknown>>(endpoints.dev.backtestPrecisionDetail, {
        params: { field, key: cacheKey },
      })
      .then((resp) => {
        const value = resp.data[responseKey(field)] as T;
        setEntry({ key: entryKey, value });
        return value;
      })
      .catch((requestError: unknown) => {
        setEntry({
          error: axios.isAxiosError(requestError)
            ? ((requestError.response?.data as { error?: string } | undefined)
                ?.error ?? requestError.message)
            : "Failed to load backtest detail",
          key: entryKey,
        });
        return undefined;
      })
      .finally(() => {
        inflight.current = null;
        setLoading(false);
      });

    inflight.current = { key: entryKey, promise };
    setLoading(true);
    return promise;
  }, [cacheKey, entry, entryKey, field]);

  const isLoading = isCurrent
    ? loading && entry.value === undefined && !entry.error
    : loading;
  // Stable object identity: memoized sections must bail out on unrelated
  // parent renders (e.g. typing in the config form), which requires the
  // artifact props they receive to keep their reference.
  return useMemo(
    () => ({ data, error, loading: isLoading, ensure }),
    [data, error, isLoading, ensure],
  );
}

/**
 * Lazy loaders for the chunked backtest artifacts. Each field resolves via
 * the detail endpoint on first `ensure()` — sections call it when they
 * expand instead of receiving the arrays inside the run response.
 *
 * `runId` (the response's `createdAt`) distinguishes artifact generations:
 * a forced recompute rewrites the same cacheKey directory, so keying entries
 * on it drops data resolved before the recompute instead of serving stale
 * arrays from the previous run.
 */
export function useBacktestArtifacts(cacheKey?: string, runId?: number) {
  const id = runId === undefined ? undefined : String(runId);
  const features = useLazyArtifact<Record<string, BacktestFeatureRecord[]>>(
    cacheKey,
    "features",
    id,
  );
  const metrics = useLazyArtifact<BacktestLeaderboardMetrics>(
    cacheKey,
    "metrics",
    id,
  );
  const positions = useLazyArtifact<Position[]>(cacheKey, "positions", id);
  const vpoints = useLazyArtifact<Record<string, VolatilityPoint[]>>(
    cacheKey,
    "vpoints",
    id,
  );
  const snapshots = useLazyArtifact<Record<string, BacktestBalanceSnapshot[]>>(
    cacheKey,
    "snapshots",
    id,
  );
  return useMemo(
    () => ({ features, metrics, positions, snapshots, vpoints }),
    [features, metrics, positions, snapshots, vpoints],
  );
}
