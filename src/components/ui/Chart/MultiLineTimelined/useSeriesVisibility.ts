"use client";

import { COLORS_BG, DEFAULT_COLORS } from "@/lib/system/utils/ui/colors";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  startTransition,
} from "react";

import type { VolatilityMultiLineProps } from "./types";

export function useSeriesVisibility({
  colors = COLORS_BG,
  defaultShowEntryGroups = false,
  names = [],
  series,
  setBrushSel,
}: Pick<
  VolatilityMultiLineProps,
  "colors" | "defaultShowEntryGroups" | "names" | "series"
> & {
  setBrushSel: React.Dispatch<
    React.SetStateAction<{ start?: number; end?: number }>
  >;
}) {
  const dataColors = useMemo(
    () =>
      series.map(
        (item, idx) =>
          item[0]?.color ?? item[1]?.color ?? colors[idx % colors.length]
      ),
    [series, colors]
  );

  const dataColorsMain = useMemo(
    () =>
      series.map(
        (item, idx) =>
          item[0]?.color ?? item[1]?.color ?? DEFAULT_COLORS[idx % DEFAULT_COLORS.length]
      ),
    [series]
  );

  const dataKeys = useMemo(() => series.map((_, i) => `s${i}`), [series]);
  const seriesNames = useMemo(
    () => series.map((_, i) => names[i] ?? `Series ${i + 1}`),
    [series, names]
  );

  const isTradeGroupDefaultVisible = useCallback(
    (group: string) =>
      group === "TRADE SIMULATION" ||
      (defaultShowEntryGroups && group.startsWith("ENTRY ")),
    [defaultShowEntryGroups],
  );

  /** 🔹 Find unique TRADE groups (TRADE SUI, TRADE BTC, etc.) */
  const tradeGroups = useMemo(() => {
    const trades = new Set<string>();
    for (const n of seriesNames) {
      if (n.startsWith("TRADE ")) {
        const parts = n.split(" ");
        if (parts.length >= 2) trades.add(`${parts[0]} ${parts[1]}`);
      }
      if (n.startsWith("ENTRY ")) {
        const parts = n.split(" ");
        if (parts.length >= 2) trades.add(`${parts[0]} ${parts[1]}`);
      }
    }
    return Array.from(trades);
  }, [seriesNames]);

  /** 🔹 State management */
  const [visible, setVisible] = useState<Set<string>>(
    () => new Set(series.map((_, i) => `s${i}`))
  );
  const [showTradeGroup, setShowTradeGroup] = useState<Record<string, boolean>>(
    () =>
      Object.fromEntries(
        tradeGroups.map((group) => [
          group,
          isTradeGroupDefaultVisible(group),
        ]),
      ),
  );

  const effectiveShowTradeGroup = useMemo(
    () => ({
      ...Object.fromEntries(
        tradeGroups.map((group) => [
          group,
          isTradeGroupDefaultVisible(group),
        ]),
      ),
      ...showTradeGroup,
    }),
    [isTradeGroupDefaultVisible, showTradeGroup, tradeGroups],
  );

  /** Reset visibility and brush selection when series changes */
  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setVisible(new Set(series.map((_, i) => `s${i}`)));
      setBrushSel({});
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [series, setBrushSel]);

  /** Toggle visibility of individual line */
  const toggle = useCallback((key: string) => {
    startTransition(() => {
      setVisible((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    });
  }, []);

  /** Isolate a line */
  const isolate = useCallback((key: string) => {
    startTransition(() => {
      setVisible(new Set([key]));
    });
  }, []);

  return {
    dataColors,
    dataColorsMain,
    dataKeys,
    effectiveShowTradeGroup,
    isolate,
    seriesNames,
    setShowTradeGroup,
    toggle,
    tradeGroups,
    visible,
  };
}
