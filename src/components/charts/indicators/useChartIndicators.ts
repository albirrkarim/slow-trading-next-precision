"use client";

import { useCallback, useMemo, useState } from "react";

import chartIndicators, {
  type ChartIndicatorsConfig,
  type VwapIndicatorConfig,
} from "@/lib/system/utils/ui/chart-indicators";

export type ChartIndicatorsApi = ReturnType<typeof useChartIndicators>;

/** Indicator stack state, persisted on every change. */
export function useChartIndicators() {
  const [config, setConfig] = useState<ChartIndicatorsConfig>(() =>
    chartIndicators.load(),
  );

  const update = useCallback(
    (fn: (prev: ChartIndicatorsConfig) => ChartIndicatorsConfig) =>
      setConfig((prev) => {
        const next = fn(prev);
        chartIndicators.save(next);
        return next;
      }),
    [],
  );

  const actions = useMemo(
    () => ({
      setVPoints: (vPoints: boolean) =>
        update((prev) => ({ ...prev, vPoints })),
      addVwap: () =>
        update((prev) => ({
          ...prev,
          vwaps: [...prev.vwaps, chartIndicators.vwap.create(prev.vwaps)],
        })),
      updateVwap: (id: string, patch: Partial<VwapIndicatorConfig>) =>
        update((prev) => ({
          ...prev,
          vwaps: prev.vwaps.map((item) =>
            item.id === id ? { ...item, ...patch } : item,
          ),
        })),
      duplicateVwap: (id: string) =>
        update((prev) => {
          const source = prev.vwaps.find((item) => item.id === id);
          if (!source) return prev;
          const { id: _id, color: _color, ...rest } = source;
          return {
            ...prev,
            vwaps: [...prev.vwaps, chartIndicators.vwap.create(prev.vwaps, rest)],
          };
        }),
      removeVwap: (id: string) =>
        update((prev) => ({
          ...prev,
          vwaps: prev.vwaps.filter((item) => item.id !== id),
        })),
    }),
    [update],
  );

  return { config, ...actions };
}
