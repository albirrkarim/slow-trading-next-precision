"use client";

import { Box, Paper, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { useMemo } from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatUsdt } from "@/components/reports/DailyPnlCalendarDialog/utils";
import HintTooltip from "@/components/ui/HintTooltip";
import type { MonteCarloResult } from "@/lib/dev/backtestPrecision/monte-carlo";

const axisTick = { fontSize: 12 };

/** Max-drawdown histogram across simulated paths with the realized value marked. */
export function MonteCarloDrawdownHistogram({
  result,
}: {
  result: MonteCarloResult;
}) {
  const theme = useTheme();
  const data = result.histogram.map((bin) => ({
    count: bin.count,
    mid: (bin.from + bin.to) / 2,
    range: `${formatUsdt(bin.from)} … ${formatUsdt(bin.to)}`,
  }));
  return (
    <Paper variant="outlined" sx={{ p: 1 }}>
      <Typography color="text.secondary" fontWeight={600} variant="body2">
        <HintTooltip title="Each bar: how many simulated paths had their worst equity dip (drawdown) in that range. The orange 'realized' line is what this backtest actually did.">
          Max drawdown distribution
        </HintTooltip>{" "}
        — realized ${formatUsdt(result.actual.maxDrawdownUsdt)} sits at the{" "}
        <HintTooltip title="Share of simulated paths that dipped less than the realized run — e.g. 60th percentile means 60% of orderings did better, so the real run was typical-to-unlucky.">
          {(result.actualDrawdownPercentile * 100).toFixed(0)}th percentile
        </HintTooltip>{" "}
        of simulated paths
      </Typography>
      <Box sx={{ height: 240, mt: 1, width: "100%" }}>
        <ResponsiveContainer height="100%" width="100%">
          <BarChart data={data} margin={{ bottom: 0, left: 0, right: 10, top: 10 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="mid"
              tick={axisTick}
              tickFormatter={(v) => formatUsdt(Number(v))}
            />
            <YAxis allowDecimals={false} tick={axisTick} />
            <Tooltip
              formatter={(value) => [value, "paths"]}
              labelFormatter={(label) =>
                `maxDD ≈ ${formatUsdt(Number(label))}`
              }
            />
            <Bar
              dataKey="count"
              fill={theme.palette.info.main}
              fillOpacity={0.7}
              isAnimationActive={false}
            />
            <ReferenceLine
              label={{ fill: theme.palette.warning.main, fontSize: 11, value: "realized" }}
              stroke={theme.palette.warning.main}
              strokeWidth={2}
              x={result.actual.maxDrawdownUsdt}
            />
            <ReferenceLine
              label={{ fill: theme.palette.text.secondary, fontSize: 11, value: "p95" }}
              stroke={theme.palette.text.secondary}
              strokeDasharray="4 4"
              x={result.drawdownUsdt.p95}
            />
          </BarChart>
        </ResponsiveContainer>
      </Box>
    </Paper>
  );
}

/** Equity fan: simulated p5–p95 band + median line + the realized path. */
export function MonteCarloEquityFan({
  result,
}: {
  result: MonteCarloResult;
}) {
  const theme = useTheme();
  const data = useMemo(
    () =>
      result.bands.map((band) => ({
        actual: result.actual.curve[band.i],
        median: band.p50,
        range: [band.p5, band.p95] as [number, number],
        trade: band.i,
      })),
    [result],
  );
  return (
    <Paper variant="outlined" sx={{ p: 1 }}>
      <Typography color="text.secondary" fontWeight={600} variant="body2">
        <HintTooltip title="Where each simulated account balance stood after N trades. Dashed line = the median path; orange = this backtest's actual path — sitting above the band means the real ordering was luckier than most.">
          Equity fan
        </HintTooltip>{" "}
        —{" "}
        <HintTooltip title="5th–95th percentile — the middle 90% of simulated outcomes at each trade number.">
          p5–p95
        </HintTooltip>{" "}
        band over trade index vs the realized path
      </Typography>
      <Box sx={{ height: 280, mt: 1, width: "100%" }}>
        <ResponsiveContainer height="100%" width="100%">
          <ComposedChart data={data} margin={{ bottom: 0, left: 0, right: 10, top: 10 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="trade" tick={axisTick} />
            <YAxis
              domain={["auto", "auto"]}
              tick={axisTick}
              tickFormatter={(v) => formatUsdt(Number(v))}
            />
            <Tooltip
              formatter={(value, name) => [
                Array.isArray(value)
                  ? `${formatUsdt(value[0])} … ${formatUsdt(value[1])}`
                  : formatUsdt(Number(value)),
                name === "range" ? "p5–p95" : name,
              ]}
              labelFormatter={(label) => `trade #${label}`}
            />
            <Area
              dataKey="range"
              fill={theme.palette.info.main}
              fillOpacity={0.15}
              isAnimationActive={false}
              name="range"
              stroke="none"
            />
            <Line
              dataKey="median"
              dot={false}
              isAnimationActive={false}
              stroke={theme.palette.info.main}
              strokeDasharray="5 4"
              strokeWidth={1.5}
            />
            <Line
              dataKey="actual"
              dot={false}
              isAnimationActive={false}
              name="actual"
              stroke={theme.palette.warning.main}
              strokeWidth={1.8}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </Box>
    </Paper>
  );
}
