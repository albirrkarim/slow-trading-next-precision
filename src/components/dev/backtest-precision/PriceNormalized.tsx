"use client";

import { useEffect, useMemo } from "react";

import { Box, Typography } from "@mui/material";

import HeaderMetrics from "@/components/ui/HeaderMetrics";
import MultiLineTimelined from "@/components/ui/Chart/MultiLineTimelined";
import type { BacktestFeatureRecord } from "@/lib/dev/backtestPrecision/backtest/backtest-precision-types";
import type { FeatureGateConfig } from "@/lib/features/types";
import type { LeveledMarkers } from "@/lib/system/utils/ui/chart-markers";
import { COLORS_BG } from "@/lib/system/utils/ui/colors";

import type { LazyArtifact } from "./use-backtest-artifacts";

const formatYTick = (value: unknown) => Number(value).toFixed(2);

function PriceNormalizedBody({
  featureGate,
  featuresMap,
  symbolOrder,
}: {
  featureGate?: FeatureGateConfig;
  featuresMap?: Record<string, BacktestFeatureRecord[]>;
  /** Volatility-rail symbol order so both charts share per-symbol colors. */
  symbolOrder: string[];
}) {
  const chartData = useMemo(() => {
    const names: string[] = [];
    const series: LeveledMarkers[][] = [];
    let fallbackIdx = 0;
    for (const symbol of Object.keys(featuresMap ?? {})) {
      const records = (featuresMap?.[symbol] ?? []).filter(
        (record) => record.priceNormalized !== undefined,
      );
      // A symbol without a defined value (fewer than two pivots in the
      // window the whole run) emits no line at all.
      if (records.length === 0) continue;
      const orderIdx = symbolOrder.indexOf(symbol);
      const color =
        COLORS_BG[
          (orderIdx >= 0 ? orderIdx : fallbackIdx) % COLORS_BG.length
        ];
      names.push(symbol);
      series.push(
        records.map((record) => ({
          color,
          level: record.priceNormalized as number,
          text: `${symbol} priceNormalized ${(
            record.priceNormalized as number
          ).toFixed(3)}`,
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

  const yReferenceLines = [
    { color: "#78909c", label: "0", y: 0 },
    { color: "#78909c", label: "1", y: 1 },
    ...(featureGate?.minPriceNormalized !== undefined
      ? [
          {
            color: "#ed6c02",
            label: `gate min ${featureGate.minPriceNormalized}`,
            y: featureGate.minPriceNormalized,
          },
        ]
      : []),
    ...(featureGate?.maxPriceNormalized !== undefined
      ? [
          {
            color: "#ed6c02",
            label: `gate max ${featureGate.maxPriceNormalized}`,
            y: featureGate.maxPriceNormalized,
          },
        ]
      : []),
  ];

  return (
    <Box
      aria-label={`Price normalized features for ${chartData.names.length} symbols`}
      role="region"
      sx={{ minWidth: 0 }}
    >
      <MultiLineTimelined
        height={300}
        lineType="stepAfter"
        names={chartData.names}
        series={chartData.series}
        yReferenceLines={yReferenceLines}
        yTickFormatter={formatYTick}
      />
    </Box>
  );
}

/**
 * Price Normalized — the recorded per-symbol `priceNormalized` feature
 * stream as step lines (values only move when a new vPoint forms), with
 * guides at 0 / 1 and the configured feature-gate bounds. Loads its
 * artifact lazily on first expand, like the other chunked sections.
 */
export default function PriceNormalized({
  featureGate,
  features,
  symbolOrder,
}: {
  featureGate?: FeatureGateConfig;
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
        expanded && <LazyBody features={features} featureGate={featureGate} symbolOrder={symbolOrder} />
      }
    </HeaderMetrics>
  );
}

/** Mounts only while expanded so the artifact request fires lazily. */
function LazyBody({
  featureGate,
  features,
  symbolOrder,
}: {
  featureGate?: FeatureGateConfig;
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
      featureGate={featureGate}
      featuresMap={data}
      symbolOrder={symbolOrder}
    />
  );
}
