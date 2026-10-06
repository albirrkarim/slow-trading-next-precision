"use client";

import { useEffect, useMemo } from "react";

import { Box, Typography } from "@mui/material";

import HeaderMetrics from "@/components/ui/HeaderMetrics";
import MultiLineTimelined from "@/components/ui/Chart/MultiLineTimelined";
import type { BacktestFeatureRecord } from "@/lib/dev/backtestPrecision/backtest/backtest-precision-types";
import type { LeveledMarkers } from "@/lib/system/utils/ui/chart-markers";
import { CHART_Y_AXIS_WIDTH } from "@/components/charts/constants";
import { DEFAULT_COLORS } from "@/lib/system/utils/ui/colors";

import type { LazyArtifact } from "./use-backtest-artifacts";

const formatYTick = (value: unknown) => Number(value).toFixed(2);

const Y_REFERENCE_LINES = [
  { color: "#78909c", label: "0", y: 0 },
  { color: "#78909c", label: "1", y: 1 },
];

/**
 * `priceNormalized` reading across record shapes — grouped `{current}`
 * now, a flat number in cache dirs written before the group existed.
 */
const recordValue = (
  record: BacktestFeatureRecord,
): number | undefined =>
  typeof record.priceNormalized === "number"
    ? record.priceNormalized
    : record.priceNormalized?.current;

function PriceNormalizedBody({
  datasetEndTimeMs,
  datasetStartTimeMs,
  featuresMap,
  symbolOrder,
}: {
  datasetEndTimeMs?: number;
  datasetStartTimeMs?: number;
  featuresMap?: Record<string, BacktestFeatureRecord[]>;
  /** Volatility-rail symbol order so both charts share per-symbol colors. */
  symbolOrder: string[];
}) {
  const chartData = useMemo(() => {
    const names: string[] = [];
    const series: LeveledMarkers[][] = [];
    let fallbackIdx = 0;
    for (const symbol of Object.keys(featuresMap ?? {})) {
      const records = (featuresMap?.[symbol] ?? [])
        .map((record) => ({ t: record.t, v: recordValue(record) }))
        .filter(
          (record): record is { t: number; v: number } =>
            record.v !== undefined,
        );
      // A symbol without a defined value (fewer than two pivots in the
      // window the whole run) emits no line at all.
      if (records.length === 0) continue;
      const orderIdx = symbolOrder.indexOf(symbol);
      const color =
        DEFAULT_COLORS[
          (orderIdx >= 0 ? orderIdx : fallbackIdx) % DEFAULT_COLORS.length
        ];
      names.push(symbol);
      series.push(
        records.map((record) => ({
          color,
          level: record.v,
          text: `${symbol} priceNormalized ${record.v.toFixed(3)}`,
          time: Math.floor(record.t / 1000),
        })),
      );
      fallbackIdx += 1;
    }
    return { names, series };
  }, [featuresMap, symbolOrder]);

  if (chartData.names.length === 0) {
    return (
      <Typography color="text.secondary" sx={{ py: 2 }} variant="body2">
        No feature records were captured for this run.
      </Typography>
    );
  }

  return (
    <Box
      aria-label={`Price normalized features for ${chartData.names.length} symbols`}
      role="region"
      sx={{ minWidth: 0 }}
    >
      <MultiLineTimelined
        colors={DEFAULT_COLORS}
        height={300}
        lineType="stepAfter"
        names={chartData.names}
        padEndTimeMs={datasetEndTimeMs}
        padStartTimeMs={datasetStartTimeMs}
        series={chartData.series}
        yAxisWidth={CHART_Y_AXIS_WIDTH}
        yReferenceLines={Y_REFERENCE_LINES}
        yTickFormatter={formatYTick}
      />
    </Box>
  );
}

/**
 * Price Normalized — the recorded per-symbol `priceNormalized` feature
 * stream as step lines (values only move when a new vPoint forms), with
 * guides at the 0 / 1 envelope edges. Loads its artifact lazily on first
 * expand, like the other chunked sections.
 */
export default function PriceNormalized({
  datasetEndTimeMs,
  datasetStartTimeMs,
  features,
  symbolOrder,
}: {
  /** Shared dataset frame — pads the axis so it aligns with Volatility Rails. */
  datasetEndTimeMs?: number;
  datasetStartTimeMs?: number;
  features: LazyArtifact<Record<string, BacktestFeatureRecord[]>>;
  symbolOrder: string[];
}) {
  return (
    <HeaderMetrics
      defaultExpanded={false}
      headerCanBeClicked
      rememberExpand="precision-backtest-price-normalized"
      sx={{ mb: 1 }}
      title={
        <Typography fontWeight={700} variant="body1">
          Price Normalized
        </Typography>
      }
    >
      {(expanded) =>
        expanded && <LazyBody datasetEndTimeMs={datasetEndTimeMs} datasetStartTimeMs={datasetStartTimeMs} features={features} symbolOrder={symbolOrder} />
      }
    </HeaderMetrics>
  );
}

/** Mounts only while expanded so the artifact request fires lazily. */
function LazyBody({
  datasetEndTimeMs,
  datasetStartTimeMs,
  features,
  symbolOrder,
}: {
  datasetEndTimeMs?: number;
  datasetStartTimeMs?: number;
  features: LazyArtifact<Record<string, BacktestFeatureRecord[]>>;
  symbolOrder: string[];
}) {
  const { ensure, error, data } = features;
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
        Loading feature records…
      </Typography>
    );
  }
  return (
    <PriceNormalizedBody
      datasetEndTimeMs={datasetEndTimeMs}
      datasetStartTimeMs={datasetStartTimeMs}
      featuresMap={data}
      symbolOrder={symbolOrder}
    />
  );
}
