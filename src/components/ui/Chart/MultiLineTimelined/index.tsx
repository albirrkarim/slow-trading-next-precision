"use client";

import { COLORS_BG } from "@/lib/system/utils/ui/colors";
import { Box } from "@mui/material";
import React, {
  useCallback,
} from "react";
import {
  Brush,
  CartesianGrid,
  Legend,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import CustomTooltip from "../CustomTooltip";
import ChartLines from "../ChartLines";

import { ChartLegend } from "./ChartLegend";
import type { VolatilityMultiLineProps } from "./types";
import { useChartData } from "./useChartData";
import { useSeriesVisibility } from "./useSeriesVisibility";

export type { VolatilityMultiLineProps } from "./types";

function MultiLineTimelined({
  series,
  names = [],
  colors = COLORS_BG,
  height = 420,
  defaultShowEntryGroups = false,
  yTickFormatter,
  yAxisWidth,
  lineType,
  yReferenceLines,
  referenceLines,
  padStartTimeMs,
  padEndTimeMs,
  brushStartTimeMs,
  brushEndTimeMs,
  onVisibleTimeRangeChange,
}: VolatilityMultiLineProps) {
  const {
    data,
    formatXAxisTick,
    reportVisibleRange,
    selEnd,
    selStart,
    setBrushSel,
    textMaps,
    xDomain,
  } = useChartData({
    brushEndTimeMs,
    brushStartTimeMs,
    onVisibleTimeRangeChange,
    padEndTimeMs,
    padStartTimeMs,
    series,
  });

  const {
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
  } = useSeriesVisibility({
    colors,
    defaultShowEntryGroups,
    names,
    series,
    setBrushSel,
  });

  /** ✅ Memoized Legend Component */
  const LegendContent = useCallback(
    () => (
      <ChartLegend
        dataColors={dataColors}
        dataKeys={dataKeys}
        effectiveShowTradeGroup={effectiveShowTradeGroup}
        isolate={isolate}
        seriesNames={seriesNames}
        setShowTradeGroup={setShowTradeGroup}
        toggle={toggle}
        tradeGroups={tradeGroups}
        visible={visible}
      />
    ),
    [
      tradeGroups,
      effectiveShowTradeGroup,
      visible,
      dataKeys,
      seriesNames,
      dataColors,
      toggle,
      isolate,
      setShowTradeGroup,
    ]
  );

  /** ✅ Render */
  return (
    <Box sx={{ width: "100%", height, py: 1 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 5, right: 8, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="timeMs"
            type="number"
            domain={xDomain}
            scale="time"
            tickFormatter={formatXAxisTick}
            minTickGap={10}
            allowDataOverflow
          />
          <YAxis tickFormatter={yTickFormatter} width={yAxisWidth ?? "auto"} />
          <Tooltip
            content={(props) => (
              <CustomTooltip
                {...(props as any)}
                textMaps={textMaps}
                names={seriesNames}
              />
            )}
          />

          <Legend content={LegendContent} />

          <ChartLines
            dataColors={dataColors}
            dataColorsMain={dataColorsMain}
            dataKeys={dataKeys}
            lineType={lineType}
            seriesNames={seriesNames}
            visible={visible}
            showTradeGroup={effectiveShowTradeGroup}
          />

          {yReferenceLines?.map((line) => (
            <ReferenceLine
              key={`y-${line.y}-${line.label ?? ""}`}
              y={line.y}
              stroke={line.color ?? "#90a4ae"}
              strokeDasharray="4 4"
              strokeWidth={1}
              ifOverflow="extendDomain"
              label={
                line.label
                  ? {
                      value: line.label,
                      position: "insideTopRight",
                      fontSize: 11,
                      fill: line.color ?? "#90a4ae",
                    }
                  : undefined
              }
            />
          ))}

          {referenceLines?.map((line) => (
            <ReferenceLine
              key={`${line.timeMs}-${line.label ?? ""}`}
              x={line.timeMs}
              stroke={line.color ?? "#d32f2f"}
              strokeDasharray="6 3"
              strokeWidth={1.5}
              ifOverflow="extendDomain"
              label={
                line.label
                  ? {
                      value: line.label,
                      position: "insideTopRight",
                      fontSize: 11,
                      fill: line.color ?? "#d32f2f",
                    }
                  : undefined
              }
            />
          ))}

          <Brush
            dataKey="timeMs"
            height={30}
            stroke="#8884d8"
            tickFormatter={formatXAxisTick}
            startIndex={selStart}
            endIndex={selEnd}
            onChange={(range) => {
              const start =
                typeof range?.startIndex === "number"
                  ? range.startIndex
                  : undefined;
              const end =
                typeof range?.endIndex === "number" ? range.endIndex : undefined;
              setBrushSel({ end, start });
              reportVisibleRange(start, end);
            }}
          />
        </LineChart>
      </ResponsiveContainer>
    </Box>
  );
}

export default React.memo(MultiLineTimelined);
