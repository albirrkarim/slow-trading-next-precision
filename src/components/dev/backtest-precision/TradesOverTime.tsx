"use client";

import { useEffect, useMemo } from "react";

import { Box, Typography } from "@mui/material";

import HeaderMetrics from "@/components/ui/HeaderMetrics";
import MultiLineTimelined from "@/components/ui/Chart/MultiLineTimelined";
import { CHART_Y_AXIS_WIDTH } from "@/components/charts/constants";
import type { Position } from "@/lib/system/trading";
import { DEFAULT_COLORS } from "@/lib/system/utils/ui/colors";
import type { LeveledMarkers } from "@/lib/system/utils/ui/chart-markers";

import type { LazyArtifact } from "./use-backtest-artifacts";

const DAY_MS = 24 * 60 * 60 * 1000;

const formatYTick = (value: unknown) => Math.round(Number(value)).toString();

/**
 * Buckets positions by UTC entry day and emits one point per day across the
 * dataset frame — days without entries emit 0 so paused stretches read as
 * the line sitting on the floor instead of being bridged over. Multiple
 * entries in one day (pair legs, bursts) aggregate into that day's count.
 */
function buildDailySeries(
  positions: Position[],
  rangeStartMs?: number,
  rangeEndMs?: number,
): LeveledMarkers[] {
  const byDay = new Map<number, string[]>();
  let minMs = Infinity;
  let maxMs = -Infinity;
  for (const position of positions) {
    const t = position.opened?.t;
    if (t === undefined || !Number.isFinite(t)) continue;
    const day = Math.floor(t / DAY_MS) * DAY_MS;
    const labels = byDay.get(day) ?? [];
    labels.push(`${position.symbol} ${position.direction}`);
    byDay.set(day, labels);
    if (t < minMs) minMs = t;
    if (t > maxMs) maxMs = t;
  }

  const startMs = rangeStartMs ?? minMs;
  const endMs = rangeEndMs ?? maxMs;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return [];

  const series: LeveledMarkers[] = [];
  const firstDay = Math.floor(startMs / DAY_MS) * DAY_MS;
  const lastDay = Math.floor(endMs / DAY_MS) * DAY_MS;
  for (let day = firstDay; day <= lastDay; day += DAY_MS) {
    const labels = byDay.get(day) ?? [];
    const date = new Date(day).toISOString().slice(0, 10);
    series.push({
      color: DEFAULT_COLORS[0],
      level: labels.length,
      text:
        labels.length === 0
          ? `${date}: no trades`
          : `${date}: ${labels.length} trade${labels.length === 1 ? "" : "s"} — ${labels.join(" · ")}`,
      time: Math.floor(day / 1000),
    });
  }
  return series;
}

function TradesOverTimeBody({
  datasetEndTimeMs,
  datasetStartTimeMs,
  positions,
}: {
  datasetEndTimeMs?: number;
  datasetStartTimeMs?: number;
  positions?: Position[];
}) {
  const series = useMemo(
    () => buildDailySeries(positions ?? [], datasetStartTimeMs, datasetEndTimeMs),
    [positions, datasetStartTimeMs, datasetEndTimeMs],
  );

  if (!positions?.length || series.length === 0) {
    return (
      <Typography color="text.secondary" sx={{ py: 2 }} variant="body2">
        No positions were opened during this run.
      </Typography>
    );
  }

  return (
    <Box
      aria-label="Daily entry count over the run"
      role="region"
      sx={{ minWidth: 0 }}
    >
      <MultiLineTimelined
        colors={[DEFAULT_COLORS[0]]}
        height={220}
        lineType="stepAfter"
        names={["Trades/day"]}
        padEndTimeMs={datasetEndTimeMs}
        padStartTimeMs={datasetStartTimeMs}
        series={[series]}
        yAxisWidth={CHART_Y_AXIS_WIDTH}
        yTickFormatter={formatYTick}
      />
    </Box>
  );
}

/**
 * Daily Trades — entries per UTC day as a step line (each day's count holds
 * until the next day), padded to the shared dataset frame so paused-day
 * zeroes line up against Volatility Rails and Price Normalized. Loads the
 * positions artifact lazily on first expand.
 */
export default function TradesOverTime({
  datasetEndTimeMs,
  datasetStartTimeMs,
  positions,
}: {
  datasetEndTimeMs?: number;
  datasetStartTimeMs?: number;
  positions: LazyArtifact<Position[]>;
}) {
  return (
    <HeaderMetrics
      defaultExpanded={false}
      headerCanBeClicked
      rememberExpand="precision-backtest-daily-trades"
      sx={{ mb: 1 }}
      title={
        <Typography fontWeight={700} variant="body1">
          Daily Trades
        </Typography>
      }
    >
      {(expanded) =>
        expanded && (
          <LazyBody
            datasetEndTimeMs={datasetEndTimeMs}
            datasetStartTimeMs={datasetStartTimeMs}
            positions={positions}
          />
        )
      }
    </HeaderMetrics>
  );
}

/** Mounts only while expanded so the artifact request fires lazily. */
function LazyBody({
  datasetEndTimeMs,
  datasetStartTimeMs,
  positions,
}: {
  datasetEndTimeMs?: number;
  datasetStartTimeMs?: number;
  positions: LazyArtifact<Position[]>;
}) {
  const { ensure, error, data } = positions;
  useEffect(() => {
    void ensure();
  }, [ensure]);

  if (error) {
    return (
      <Typography color="error" sx={{ py: 2 }} variant="body2">
        {error}
      </Typography>
    );
  }
  if (data === undefined) {
    return (
      <Typography color="text.secondary" sx={{ py: 2 }} variant="body2">
        Loading positions…
      </Typography>
    );
  }
  return (
    <TradesOverTimeBody
      datasetEndTimeMs={datasetEndTimeMs}
      datasetStartTimeMs={datasetStartTimeMs}
      positions={data}
    />
  );
}
