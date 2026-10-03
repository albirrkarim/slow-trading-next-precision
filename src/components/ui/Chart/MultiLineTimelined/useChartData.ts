"use client";

import moment from "moment";
import { useCallback, useEffect, useMemo, useState } from "react";

import { buildMergedData } from "../utils";

import type { VolatilityMultiLineProps } from "./types";

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export function useChartData({
  brushEndTimeMs,
  brushStartTimeMs,
  onVisibleTimeRangeChange,
  padEndTimeMs,
  padStartTimeMs,
  series,
}: Pick<
  VolatilityMultiLineProps,
  | "brushEndTimeMs"
  | "brushStartTimeMs"
  | "onVisibleTimeRangeChange"
  | "padEndTimeMs"
  | "padStartTimeMs"
  | "series"
>) {
  const { data, textMaps } = useMemo(() => {
    const merged = buildMergedData(series);
    const padRow = (timeMs: number): Record<string, any> => ({
      time: new Date(timeMs).toISOString(),
      timeMs,
      ...Object.fromEntries(series.map((_, i) => [`s${i}`, null])),
    });
    const first = Number(merged.data[0]?.timeMs);
    const last = Number(merged.data[merged.data.length - 1]?.timeMs);
    if (
      padStartTimeMs !== undefined &&
      (!Number.isFinite(first) || padStartTimeMs < first)
    ) {
      merged.data.unshift(padRow(padStartTimeMs));
    }
    if (
      padEndTimeMs !== undefined &&
      (!Number.isFinite(last) || padEndTimeMs > last)
    ) {
      merged.data.push(padRow(padEndTimeMs));
    }
    return merged;
  }, [series, padStartTimeMs, padEndTimeMs]);

  const brushStartIndex = useMemo(() => {
    if (brushStartTimeMs == null) return undefined;
    const idx = data.findIndex((item) => Number(item.timeMs) >= brushStartTimeMs);
    return idx >= 0 ? idx : undefined;
  }, [data, brushStartTimeMs]);

  const brushEndIndex = useMemo(() => {
    if (brushEndTimeMs == null) return undefined;
    for (let i = data.length - 1; i >= 0; i--) {
      if (Number(data[i].timeMs) <= brushEndTimeMs) return i;
    }
    return undefined;
  }, [data, brushEndTimeMs]);

  /** Brush selection in data indices — prop-snapped until the user drags. */
  const [brushSel, setBrushSel] = useState<{
    start?: number;
    end?: number;
  }>({});
  const selStart = brushSel.start ?? brushStartIndex;
  const selEnd = brushSel.end ?? brushEndIndex;

  /** X domain follows the brush window so selections stretch full-width. */
  const xDomain = useMemo((): [number | string, number | string] => {
    if (data.length === 0) return ["dataMin", "dataMax"];
    const s = Math.min(Math.max(selStart ?? 0, 0), data.length - 1);
    const e = Math.min(Math.max(selEnd ?? data.length - 1, 0), data.length - 1);
    const min = Number(data[Math.min(s, e)].timeMs);
    const max = Number(data[Math.max(s, e)].timeMs);
    return [
      Number.isFinite(min) ? min : "dataMin",
      Number.isFinite(max) ? max : "dataMax",
    ];
  }, [data, selStart, selEnd]);

  /** Resolves a brush index pair to the covered point-time range. */
  const reportVisibleRange = useCallback(
    (startIndex: number | undefined, endIndex: number | undefined) => {
      if (!onVisibleTimeRangeChange || data.length === 0) return;
      const startTime = Number(
        data[Math.min(Math.max(startIndex ?? 0, 0), data.length - 1)]?.timeMs,
      );
      const endTime = Number(
        data[Math.min(Math.max(endIndex ?? data.length - 1, 0), data.length - 1)]
          ?.timeMs,
      );
      if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return;
      onVisibleTimeRangeChange({
        endTime: Math.max(startTime, endTime),
        startTime: Math.min(startTime, endTime),
      });
    },
    [data, onVisibleTimeRangeChange],
  );

  /** Emit the initial domain — brush-snapped when bounds were supplied. */
  useEffect(() => {
    reportVisibleRange(brushStartIndex, brushEndIndex);
  }, [brushStartIndex, brushEndIndex, reportVisibleRange]);

  const xAxisDateFormat = useMemo(() => {
    const times = data
      .map((item) => Number(item.timeMs))
      .filter((time) => Number.isFinite(time));
    if (times.length < 2) return "DD MMM";
    return Math.max(...times) - Math.min(...times) < ONE_YEAR_MS
      ? "DD MMM"
      : "DD MMM YY";
  }, [data]);
  const formatXAxisTick = useCallback(
    (value: unknown) => moment.utc(Number(value)).format(xAxisDateFormat),
    [xAxisDateFormat],
  );

  return {
    brushSel,
    data,
    formatXAxisTick,
    reportVisibleRange,
    selEnd,
    selStart,
    setBrushSel,
    textMaps,
    xDomain,
  };
}
