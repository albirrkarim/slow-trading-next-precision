"use client";

import {
  Box,
  alpha,
  useTheme,
} from "@mui/material";
import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { BlackSwanSavingsBacktestResult } from "@/lib/dev/black-swan";

import { formatUsdt } from "./shared";

function buildZones(result: BlackSwanSavingsBacktestResult) {
  const startT = result.entryT - 10 * 60_000;
  const endT = result.incidentT + 90 * 60_000;
  const points = result.points.filter(
    (point) => point.t >= startT && point.t <= endT,
  );
  const visiblePoints = points.length > 1 ? points : result.points;
  const zones: Array<{
    from: number;
    status: BlackSwanSavingsBacktestResult["points"][number]["status"];
    to: number;
  }> = [];
  for (const point of visiblePoints) {
    const latest = zones.at(-1);
    if (latest?.status === point.status) {
      latest.to = point.t;
    } else {
      zones.push({ from: point.t, status: point.status, to: point.t });
    }
  }
  return { points: visiblePoints, zones };
}

export function ProtectionPnlChart({
  result,
}: {
  result: BlackSwanSavingsBacktestResult;
}) {
  const theme = useTheme();
  const chart = useMemo(() => buildZones(result), [result]);
  const stateColors = {
    NORMAL: alpha(theme.palette.info.light, 0.25),
    WATCH: alpha(theme.palette.warning.light, 0.28),
    CRISIS: alpha(theme.palette.error.light, 0.28),
    RECOVERY: alpha(theme.palette.secondary.light, 0.25),
  } as const;
  const crisisT = result.transitions.find(
    (transition) => transition.to === "CRISIS",
  )?.t;

  return (
    <Box
      aria-label="Portfolio PnL with the current Black Swan configuration"
      sx={{ height: { xs: 280, md: 340 }, minWidth: 0 }}
    >
      <ResponsiveContainer
        height="100%"
        initialDimension={{ height: 280, width: 300 }}
        minWidth={0}
        width="100%"
      >
        <LineChart
          data={chart.points}
          margin={{ bottom: 8, left: 8, right: 16, top: 16 }}
        >
          <CartesianGrid strokeDasharray="3 3" />
          {chart.zones.map((zone, index) => (
            <ReferenceArea
              fill={stateColors[zone.status]}
              key={`${zone.from}-${zone.status}-${index}`}
              x1={zone.from}
              x2={zone.to}
            />
          ))}
          <ReferenceLine
            label={{
              fill: theme.palette.text.secondary,
              fontSize: 11,
              position: "insideTopLeft",
              value: "Positions open",
            }}
            stroke={theme.palette.text.secondary}
            strokeDasharray="4 4"
            x={result.entryT}
          />
          {crisisT && (
            <ReferenceLine
              label={{
                fill: theme.palette.error.main,
                fontSize: 11,
                position: "insideTopRight",
                value: "PROTECTION START (CRISIS)",
              }}
              stroke={theme.palette.error.main}
              strokeDasharray="5 4"
              x={crisisT}
            />
          )}
          <XAxis
            dataKey="t"
            domain={["dataMin", "dataMax"]}
            scale="time"
            tickFormatter={(value) =>
              new Date(Number(value)).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })
            }
            type="number"
          />
          <YAxis
            tickFormatter={(value) => formatUsdt(Number(value))}
            width={82}
          />
          <Tooltip
            formatter={(value, name) => [formatUsdt(Number(value)), name]}
            labelFormatter={(value) => new Date(Number(value)).toLocaleString()}
          />
          <Line
            dataKey="protectedPnlUsdt"
            dot={false}
            isAnimationActive={false}
            name="Current Black Swan config"
            stroke={theme.palette.success.main}
            strokeWidth={2.5}
            type="monotone"
          />
        </LineChart>
      </ResponsiveContainer>
    </Box>
  );
}
