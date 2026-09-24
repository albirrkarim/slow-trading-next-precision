"use client";

import { useMemo } from "react";

import { Box, Typography } from "@mui/material";

import HeaderMetrics from "@/components/ui/HeaderMetrics";
import MultiLineTimelined from "@/components/ui/Chart/MultiLineTimelined";
import { makeSeries } from "@/components/LiveDashboard/utils";
import type { VolatilityPoint } from "@/lib/system/types";


export default function VolatilityRails({
  volatilityMap,
}: {
  volatilityMap: Record<string, VolatilityPoint[]>;
}) {
  const chartData = useMemo(() => {
    const names = Object.keys(volatilityMap);
    const { series } = makeSeries(volatilityMap);

    return {
      names,
      series,
      totalPoints: series.reduce((total, points) => total + points.length, 0),
    };
  }, [volatilityMap]);

  return (
    <HeaderMetrics
      defaultExpanded={false}
      headerCanBeClicked
      rememberExpand="precision-backtest-volatility-rails"
      sx={{ mb: 1 }}
      title={
        <Typography fontWeight={700} variant="body1">
          Volatility Rails
        </Typography>
      }
    >
      {(expanded) =>
        expanded &&
        (chartData.totalPoints > 0 ? (
          <Box
            aria-label={`Volatility rails for ${chartData.names.length} symbols`}
            role="region"
            sx={{ minWidth: 0 }}
          >
            <MultiLineTimelined
              height={420}
              names={chartData.names}
              series={chartData.series}
            />
          </Box>
        ) : (
          <Typography color="text.secondary" sx={{ py: 2 }} variant="body2">
            No volatility points were detected.
          </Typography>
        ))
      }
    </HeaderMetrics>
  );
}
