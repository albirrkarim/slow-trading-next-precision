"use client";

import { useCallback, useMemo, useState } from "react";

import { Box, Typography } from "@mui/material";

import BlackSwanTimeline, {
  type BlackSwanTimelineVisibleRange,
} from "@/components/reports/BlackSwanTimeline";
import HeaderMetrics from "@/components/ui/HeaderMetrics";
import MultiLineTimelined from "@/components/ui/Chart/MultiLineTimelined";
import type { BacktestBlackSwanTimeline } from "@/lib/dev/backtestPrecision/backtest/backtest-precision-types";
import { makeSeries } from "@/lib/system/utils/ui/series";
import type { VolatilityPoint } from "@/lib/system/types";


export default function VolatilityRails({
  blackSwanTimeline,
  datasetEndTimeMs,
  datasetStartTimeMs,
  tradingStartTimeMs,
  volatilityMap,
}: {
  blackSwanTimeline?: BacktestBlackSwanTimeline;
  /** Raw dataset bounds — the full axis the timeline is clipped against. */
  datasetEndTimeMs?: number;
  datasetStartTimeMs?: number;
  /** Dataset start + vPoint warm-up — the moment the simulated clock began. */
  tradingStartTimeMs?: number;
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

  const [visibleRange, setVisibleRange] = useState<
    { key: string; range: BlackSwanTimelineVisibleRange } | undefined
  >(undefined);
  const rangeKey = `${datasetStartTimeMs ?? ""}:${datasetEndTimeMs ?? ""}`;
  const onVisibleRange = useCallback(
    (range: BlackSwanTimelineVisibleRange) =>
      setVisibleRange({ key: rangeKey, range }),
    [rangeKey],
  );
  const effectiveRange =
    visibleRange?.key === rangeKey ? visibleRange.range : undefined;

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
        expanded && (
          <Box
            aria-label={`Volatility rails for ${chartData.names.length} symbols`}
            role="region"
            sx={{ minWidth: 0 }}
          >
            {chartData.totalPoints > 0 ? (
              <MultiLineTimelined
                height={420}
                names={chartData.names}
                onVisibleTimeRangeChange={onVisibleRange}
                referenceLines={
                  tradingStartTimeMs !== undefined
                    ? [
                        {
                          color: "#ed6c02",
                          label: "Warm-up ends · trading starts",
                          timeMs: tradingStartTimeMs,
                        },
                      ]
                    : undefined
                }
                series={chartData.series}
              />
            ) : (
              <Typography color="text.secondary" sx={{ py: 2 }} variant="body2">
                No volatility points were detected.
              </Typography>
            )}
            <BlackSwanTimeline
              datasetEndTimeMs={datasetEndTimeMs}
              datasetStartTimeMs={datasetStartTimeMs}
              timeline={blackSwanTimeline}
              visibleRange={effectiveRange}
              warmupEndTimeMs={tradingStartTimeMs}
            />
          </Box>
        )
      }
    </HeaderMetrics>
  );
}
