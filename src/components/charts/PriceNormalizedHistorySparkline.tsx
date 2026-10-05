"use client";

import { Box } from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import {
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

/**
 * Miniature line chart of a coin's `priceNormalized` trail. Dashed guides mark
 * the documented 0–1 envelope so breakouts read at a glance; `current` (the
 * entry-time value) is drawn as the tail point at `entryTimeMs`.
 */
export function PriceNormalizedHistorySparkline(props: {
  history?: {
    t: number;
    p: number;
  }[];
  current?: number;
  entryTimeMs?: number;
  height?: number;
}) {
  const theme = useTheme();
  const { history, current, entryTimeMs, height = 24 } = props;

  const data = (Array.isArray(history) ? history : [])
    .filter(
      (p) =>
        typeof p?.t === "number" &&
        Number.isFinite(p.t) &&
        typeof p?.p === "number" &&
        Number.isFinite(p.p),
    )
    .sort((a, b) => a.t - b.t)
    .map((p) => ({ t: p.t, v: p.p }));

  const last = data.at(-1);
  if (
    typeof current === "number" &&
    Number.isFinite(current) &&
    (last === undefined || current !== last.v)
  ) {
    data.push({ t: entryTimeMs ?? last?.t ?? 0, v: current });
  }

  if (data.length < 2) return null;

  const lastV = data.at(-1)?.v;
  const stroke =
    lastV !== undefined && (lastV < 0 || lastV > 1)
      ? theme.palette.warning.main
      : theme.palette.info.main;

  const min = Math.min(0, ...data.map((d) => d.v));
  const max = Math.max(1, ...data.map((d) => d.v));
  const pad = Math.max((max - min) * 0.08, 0.05);

  const formatTooltipTime = (value: number) => {
    const timestamp = Number(value);
    if (!Number.isFinite(timestamp)) return "";
    return new Date(timestamp).toLocaleString(undefined, {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  };

  return (
    <Box sx={{ width: "100%", minWidth: 80, height }}>
      <ResponsiveContainer width="100%" height="100%" minWidth={80} minHeight={height}>
        <LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} hide />
          <YAxis domain={[min - pad, max + pad]} hide />
          <ReferenceLine
            y={0}
            stroke={alpha(theme.palette.text.primary, 0.35)}
            strokeDasharray="3 3"
          />
          <ReferenceLine
            y={1}
            stroke={alpha(theme.palette.text.primary, 0.35)}
            strokeDasharray="3 3"
          />
          <Tooltip
            isAnimationActive={false}
            formatter={(value: any) => [Number(value).toFixed(3), "priceNorm"]}
            labelFormatter={(label: any) => formatTooltipTime(Number(label))}
            contentStyle={{
              backgroundColor: theme.palette.background.paper,
              border: `1px solid ${theme.palette.divider}`,
              borderRadius: 8,
              boxShadow: theme.shadows[2],
            }}
            labelStyle={{ color: theme.palette.text.secondary }}
            itemStyle={{ color: theme.palette.text.primary }}
          />
          <Line
            type="monotone"
            dataKey="v"
            stroke={alpha(stroke, 0.95)}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
          {lastV !== undefined ? (
            <ReferenceDot
              x={data[data.length - 1].t}
              y={lastV}
              r={2.5}
              fill={stroke}
              stroke="none"
            />
          ) : null}
        </LineChart>
      </ResponsiveContainer>
    </Box>
  );
}
