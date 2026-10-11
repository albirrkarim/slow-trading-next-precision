"use client";

import { useCallback, useMemo, useState } from "react";

import type { FeatureIndicatorDefs } from "@/lib/features/indicators";
import chartIndicators, {
  type ChartIndicatorsConfig,
  type EmaChartConfig,
  type SupertrendChartConfig,
  type VPointSourceConfig,
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
      updateVPointSource: (patch: Partial<VPointSourceConfig>) =>
        update((prev) => ({ ...prev, vPointSource: { ...prev.vPointSource, ...patch } })),
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
      addSupertrend: () =>
        update((prev) => ({
          ...prev,
          supertrends: [...prev.supertrends, chartIndicators.supertrend.create()],
        })),
      updateSupertrend: (id: string, patch: Partial<SupertrendChartConfig>) =>
        update((prev) => ({
          ...prev,
          supertrends: prev.supertrends.map((item) =>
            item.id === id ? { ...item, ...patch } : item,
          ),
        })),
      duplicateSupertrend: (id: string) =>
        update((prev) => {
          const source = prev.supertrends.find((item) => item.id === id);
          if (!source) return prev;
          const { id: _id, ...rest } = source;
          return {
            ...prev,
            supertrends: [...prev.supertrends, chartIndicators.supertrend.create(rest)],
          };
        }),
      removeSupertrend: (id: string) =>
        update((prev) => ({
          ...prev,
          supertrends: prev.supertrends.filter((item) => item.id !== id),
        })),
      addEma: () =>
        update((prev) => ({
          ...prev,
          emas: [...prev.emas, chartIndicators.ema.create(prev)],
        })),
      updateEma: (id: string, patch: Partial<EmaChartConfig>) =>
        update((prev) => ({
          ...prev,
          emas: prev.emas.map((item) =>
            item.id === id ? { ...item, ...patch } : item,
          ),
        })),
      duplicateEma: (id: string) =>
        update((prev) => {
          const source = prev.emas.find((item) => item.id === id);
          if (!source) return prev;
          const { id: _id, color: _color, ...rest } = source;
          return { ...prev, emas: [...prev.emas, chartIndicators.ema.create(prev, rest)] };
        }),
      removeEma: (id: string) =>
        update((prev) => ({
          ...prev,
          emas: prev.emas.filter((item) => item.id !== id),
        })),
      /** Adds chart instances mirroring captured feature definitions. */
      addFromDefs: (defs: FeatureIndicatorDefs) =>
        update((prev) => {
          const added = chartIndicators.fromDefs(defs, prev);
          return {
            ...prev,
            vwaps: [...prev.vwaps, ...added.vwaps],
            supertrends: [...prev.supertrends, ...added.supertrends],
            emas: [...prev.emas, ...added.emas],
          };
        }),
    }),
    [update],
  );

  return { config, ...actions };
}
