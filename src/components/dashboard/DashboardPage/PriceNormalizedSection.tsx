"use client";

import { useEffect, useMemo, useState } from "react";

import { Typography } from "@mui/material";
import axios from "axios";

import { endpoints } from "@/components/endpoints";
import type { BlackSwanTimelineVisibleRange } from "@/components/reports/BlackSwanTimeline";
import MultiLineTimelined from "@/components/ui/Chart/MultiLineTimelined";
import HeaderMetrics from "@/components/ui/HeaderMetrics";
import TypographyTooltip from "@/components/ui/TypographyTooltip";
import { CHART_Y_AXIS_WIDTH } from "@/components/charts/constants";
import type { RuntimeDashboardState } from "@/lib/system/dashboard";
import type { RuntimeFeatures } from "@/lib/features/types";
import type { RuntimeMode } from "@/lib/system/runtime/types";
import type { LeveledMarkers } from "@/lib/system/utils/ui/chart-markers";
import { DEFAULT_COLORS } from "@/lib/system/utils/ui/colors";

import type { DashboardConfig } from "./types";

const formatYTick = (value: unknown) => Number(value).toFixed(2);

const Y_REFERENCE_LINES = [
  { color: "#78909c", label: "0", y: 0 },
  { color: "#78909c", label: "1", y: 1 },
];

interface FeaturesSnapshot {
  /** Server clock at read time (ms). */
  t: number;
  mode: RuntimeMode;
  features: RuntimeFeatures | null;
}

/**
 * Live Price Normalized — each coin's `priceNormalizedHistory` trail as a
 * step line (values only move when a new vPoint forms), plus a flat tail at
 * the fetch time so the current value reads at the right edge. Follows the
 * Volatility Points brush selection above it.
 */
export default function PriceNormalizedSection({
  config,
  dashboardState,
  isMobile,
  onVolatilityVisibleRange,
  symbols,
  volatilityRange,
}: {
  config: DashboardConfig;
  dashboardState: RuntimeDashboardState | null;
  isMobile: boolean;
  onVolatilityVisibleRange: (range: BlackSwanTimelineVisibleRange) => void;
  /** Symbol order shared with the Volatility Points chart (colors match). */
  symbols: string[];
  volatilityRange?: BlackSwanTimelineVisibleRange;
}) {
  return (
    <HeaderMetrics
      defaultExpanded={!isMobile}
      headerCanBeClicked
      rememberExpand="price-normalized"
      sx={{ mt: 2 }}
      title={
        <TypographyTooltip
          variant="body1"
          sx={{ fontWeight: "bold" }}
          gutterBottom
        >
          Price Normalized
        </TypographyTooltip>
      }
    >
      {(expanded) =>
        expanded && (
          <PriceNormalizedBody
            config={config}
            dashboardState={dashboardState}
            onVolatilityVisibleRange={onVolatilityVisibleRange}
            symbols={symbols}
            volatilityRange={volatilityRange}
          />
        )
      }
    </HeaderMetrics>
  );
}

/** Mounts only while expanded; refetches whenever the dashboard state polls. */
function PriceNormalizedBody({
  config,
  dashboardState,
  onVolatilityVisibleRange,
  symbols,
  volatilityRange,
}: {
  config: DashboardConfig;
  dashboardState: RuntimeDashboardState | null;
  onVolatilityVisibleRange: (range: BlackSwanTimelineVisibleRange) => void;
  symbols: string[];
  volatilityRange?: BlackSwanTimelineVisibleRange;
}) {
  const mode: RuntimeMode = dashboardState?.activeMode ?? "live";
  const [result, setResult] = useState<{
    error?: string;
    snapshot?: FeaturesSnapshot;
  }>({});

  useEffect(() => {
    let active = true;
    axios
      .get<FeaturesSnapshot>(endpoints.system.features, { params: { mode } })
      .then((response) => {
        if (active) setResult({ snapshot: response.data });
      })
      .catch((fetchError) => {
        if (!active) return;
        setResult({
          error:
            fetchError?.response?.data?.error ??
            fetchError?.message ??
            "Failed to load feature data",
        });
      });
    return () => {
      active = false;
    };
    // `dashboardState` identity turns over on every dashboard poll — reuses
    // the existing refresh cadence instead of running its own timer.
  }, [mode, dashboardState]);

  const snapshot = result.snapshot ?? null;
  const error = result.error ?? null;

  const chartData = useMemo(() => {
    const coins = snapshot?.features?.coins ?? {};
    const fetchedAt = snapshot?.t ?? 0;
    const names: string[] = [];
    const series: LeveledMarkers[][] = [];
    for (let symbolIdx = 0; symbolIdx < symbols.length; symbolIdx += 1) {
      const symbol = symbols[symbolIdx];
      const coin = coins[symbol];
      if (!coin) continue;
      const trail = coin.priceNormalizedHistory ?? [];
      const points = [...trail];
      // The trail stores change points only; a flat tail at the snapshot
      // time stretches the step line to "now" so the live value is visible.
      if (
        typeof coin.priceNormalized === "number" &&
        fetchedAt > 0 &&
        (points.at(-1)?.t ?? 0) < fetchedAt
      ) {
        points.push({ t: fetchedAt, p: coin.priceNormalized });
      }
      if (points.length === 0) continue;
      const color = DEFAULT_COLORS[symbolIdx % DEFAULT_COLORS.length];
      names.push(symbol);
      series.push(
        points.map((point) => ({
          color,
          level: point.p,
          text: `${symbol} priceNormalized ${point.p.toFixed(3)}`,
          time: Math.floor(point.t / 1000),
        })),
      );
    }
    return { names, series };
  }, [snapshot, symbols]);

  if (error) {
    return (
      <Typography color="error" sx={{ py: 2 }} variant="body2">
        {error}
      </Typography>
    );
  }

  if (!snapshot) {
    return (
      <Typography color="text.secondary" sx={{ py: 2 }} variant="body2">
        Loading feature data...
      </Typography>
    );
  }

  if (chartData.names.length === 0) {
    return (
      <Typography color="text.secondary" sx={{ py: 2 }} variant="body2">
        No feature data recorded yet.
      </Typography>
    );
  }

  return (
    <MultiLineTimelined
      brushEndTimeMs={volatilityRange?.endTime}
      brushStartTimeMs={volatilityRange?.startTime}
      colors={DEFAULT_COLORS}
      height={300}
      lineType="stepAfter"
      names={chartData.names}
      onVisibleTimeRangeChange={onVolatilityVisibleRange}
      padEndTimeMs={config.endTime}
      padStartTimeMs={config.startTime}
      series={chartData.series}
      yAxisWidth={CHART_Y_AXIS_WIDTH}
      yReferenceLines={Y_REFERENCE_LINES}
      yTickFormatter={formatYTick}
    />
  );
}
