"use client";

import { Box, Paper, Typography } from "@mui/material";
import { useMemo } from "react";

import HeaderMetrics from "@/components/ui/HeaderMetrics";
import VPointPctDistribution from "@/components/charts/VPointPctDistribution";
import type { VolatilityPoint } from "@/lib/system/types";
import { runtimeEntrySequences } from "@/lib/system/trading";
import format from "@/lib/system/utils/format";

import { VPointLevelRow } from "./VPointLevelRow";
import {
  calculateVPointLevelHeatPct,
  formatVPointPct,
  getVPointLevelProgressions,
  summarizeVPointLevelMaxDrawdowns,
  summarizeVPoints,
} from "./summary";

export {
  buildVPointLevelMaxDrawdownTooltip,
  calculateVPointLevelHeatPct,
  calculateVPointLevelProgressionPct,
  countRangedVPointLevelFrequency,
  getVPointLevelProgressions,
  summarizeRangedVPoints,
  summarizeVPointLevelMaxDrawdowns,
} from "./summary";
export type {
  RangedVPointsSummary,
  VPointLevelFrequency,
  VPointLevelMaxDrawdown,
  VPointLevelProgression,
  VPointPctMetrics,
} from "./summary";

export default function VPointsFrequency({
  endTime,
  startTime,
  volatilityMap,
}: {
  endTime?: number;
  startTime?: number;
  volatilityMap: Record<string, VolatilityPoint[]>;
}) {
  return (
    <HeaderMetrics
      defaultExpanded={false}
      rememberExpand="vpoints-frequency"
      title={
        <Typography fontWeight="bold" variant="body1">
          VPoints Summary
        </Typography>
      }
      headerCanBeClicked
    >
      {(expanded) =>
        expanded && (
          <VPointsFrequencyContent
            endTime={endTime}
            startTime={startTime}
            volatilityMap={volatilityMap}
          />
        )
      }
    </HeaderMetrics>
  );
}

function VPointsFrequencyContent({
  endTime,
  startTime,
  volatilityMap,
}: {
  endTime?: number;
  startTime?: number;
  volatilityMap: Record<string, VolatilityPoint[]>;
}) {
  const { maxPctSymbol, maxPctAt, minPctSymbol, minPctAt, points, summary, symbolsByLevel } =
    useMemo(() => {
      const rangedMap = runtimeEntrySequences.range.crop({
        endTimeMs: endTime,
        startTimeMs: startTime,
        volatilityMap,
      });
      const rangedPoints = Object.entries(rangedMap).flatMap(
        ([symbol, symbolPoints]) =>
          symbolPoints.map((point) =>
            point.symbol ? point : { ...point, symbol },
          ),
      );
      const levelSymbolCounts = new Map<number, Map<string, number>>();
      let maxPct = Number.NEGATIVE_INFINITY;
      let minPct = Number.POSITIVE_INFINITY;
      let maxSymbol: string | null = null;
      let minSymbol: string | null = null;
      let maxAt: number | null = null;
      let minAt: number | null = null;
      for (const [symbol, symbolPoints] of Object.entries(rangedMap)) {
        for (const point of symbolPoints) {
          if (Number.isInteger(point.lvl)) {
            const levelCounts = levelSymbolCounts.get(point.lvl) ?? new Map<string, number>();
            levelCounts.set(symbol, (levelCounts.get(symbol) ?? 0) + 1);
            levelSymbolCounts.set(point.lvl, levelCounts);
          }
          if (!Number.isFinite(point.pct)) continue;
          if (point.pct > maxPct) {
            maxPct = point.pct;
            maxSymbol = symbol;
            maxAt = point.t;
          }
          if (point.pct < minPct) {
            minPct = point.pct;
            minSymbol = symbol;
            minAt = point.t;
          }
        }
      }
      return {
        maxPctSymbol: maxSymbol,
        maxPctAt: maxAt,
        minPctSymbol: minSymbol,
        minPctAt: minAt,
      points: rangedPoints,
      symbolsByLevel: levelSymbolCounts,
      // PROD:VPOINTS_FREQUENCY
      // PROD:VPOINTS_SUMMARY_PCT
      summary: summarizeVPoints(rangedPoints),
    };
  }, [endTime, startTime, volatilityMap]);
  const frequencies = summary.frequencies;
  const countByLevel = new Map(
    frequencies.map(({ count, level }) => [level, count]),
  );
  const maxDrawdownByLevel = useMemo(
    () => summarizeVPointLevelMaxDrawdowns(points),
    [points],
  );
  const maximumCount = Math.max(...frequencies.map(({ count }) => count));

  if (frequencies.length === 0) {
    return (
      <Paper
        sx={{ color: "text.secondary", mt: 1, p: 2, textAlign: "center" }}
        variant="outlined"
      >
        No vPoints in this range
      </Paper>
    );
  }

  return (
    <Box sx={{ mt: 0.5 }}>
      <Typography color="text.secondary" variant="caption">
        {summary.total.toLocaleString()} vPoints · current range
      </Typography>
      <Box
        aria-label="Current range vPoint percentage metrics"
        sx={{
          display: "grid",
          gap: 0.75,
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          mt: 0.75,
        }}
      >
        {(
          [
            ["Max", summary.pct.max, maxPctSymbol, maxPctAt],
            ["Avg", summary.pct.avg, null, null],
            ["Min", summary.pct.min, minPctSymbol, minPctAt],
          ] as const
        ).map(([label, value, symbol, at]) => (
          <Paper
            key={label}
            sx={{ minWidth: 0, px: 1, py: 0.75, textAlign: "center" }}
            variant="outlined"
          >
            <Typography color="text.secondary" display="block" variant="caption">
              {label} pct
            </Typography>
            <Typography fontWeight={700} noWrap variant="body2">
              {formatVPointPct(value)}
            </Typography>
            <Typography
              color="text.secondary"
              display="block"
              noWrap
              title={symbol ?? undefined}
              variant="caption"
            >
              {symbol ? symbol.replace(/_USDT$/, "") : " "}
            </Typography>
            <Typography color="text.secondary" display="block" variant="caption">
              {at ? format.timeForLog(at) : " "}
            </Typography>
          </Paper>
        ))}
      </Box>
      <VPointPctDistribution points={points} rangeLabel="current" />
      <Paper sx={{ mt: 0.75 }} variant="outlined">
        {frequencies.map(({ count, level }, index) => (
          <VPointLevelRow
            count={count}
            heatPct={calculateVPointLevelHeatPct({
              count,
              maximumCount,
            })}
            index={index}
            key={level}
            level={level}
            maxDrawdown={maxDrawdownByLevel.get(level)}
            progressions={getVPointLevelProgressions({
              countByLevel,
              level,
            })}
            symbolCounts={symbolsByLevel.get(level)}
          />
        ))}
      </Paper>
    </Box>
  );
}
