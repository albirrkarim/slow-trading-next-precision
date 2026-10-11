"use client";

import { Alert, Box, Chip, CircularProgress, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { useMemo, useRef } from "react";

import CurrencyChart from "@/components/charts/CurrencyChart";
import IndicatorLegend from "@/components/charts/indicators/IndicatorLegend";
import IndicatorsMenu from "@/components/charts/indicators/IndicatorsMenu";
import { useChartIndicators } from "@/components/charts/indicators/useChartIndicators";
import { useChartOverlays } from "@/components/charts/indicators/useChartOverlays";
import { useFillHeight } from "@/components/charts/useFillHeight";
import type { IntervalKlines } from "@/lib/exchange";

import type { LiveMarket } from "./binanceLiveSocket";
import { useLiveKlines, type LiveStatus } from "./useLiveKlines";

const STATUS_CHIP: Record<LiveStatus, { label: string; color: "success" | "warning" | "default" }> = {
  connecting: { color: "default", label: "Connecting…" },
  live: { color: "success", label: "● Live" },
  reconnecting: { color: "warning", label: "Reconnecting…" },
};

/**
 * One coin/interval live chart: streamed candles, scroll-back history, the
 * shared indicator stack (menu + legend + overlays) and stored vPoints.
 * Mount with a `key` per coin/interval/market for fresh state.
 */
export default function LiveChart({
  symbol,
  interval,
  market,
  controls,
}: {
  symbol: string;
  interval: IntervalKlines;
  market: LiveMarket;
  /** Coin/market/interval pickers rendered at the toolbar's start. */
  controls: ReactNode;
}) {
  const live = useLiveKlines({ interval, market, symbol });
  const indicators = useChartIndicators();
  const chartBoxRef = useRef<HTMLDivElement>(null);
  const height = useFillHeight(chartBoxRef, { enabled: true, fallback: 600, min: 360, reserve: 16 });

  // Overlays fold closed candles only, so they rebuild when a candle
  // closes or history loads — not on every live tick.
  const closedKey = `${live.candles.length}:${live.candles.at(-2)?.time}`;
  const closedCandles = useMemo(
    () => live.candles.slice(0, -1),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [closedKey],
  );
  const vPointTimes = useMemo(() => live.markers.map((marker) => marker.time * 1000), [live.markers]);
  const overlays = useChartOverlays({
    candles: closedCandles,
    exchange: "binance",
    indicators,
    marketType: market,
    symbol,
    vPointTimes,
  });
  const markers = useMemo(
    () => (indicators.config.vPoints ? live.markers : []),
    [indicators.config.vPoints, live.markers],
  );
  const chip = STATUS_CHIP[live.status];

  return (
    <Box sx={{ display: "grid", gap: 1 }}>
      <Box sx={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 1 }}>
        {controls}
        <IndicatorsMenu hasVPoints={vPointTimes.length > 0} indicators={indicators} />
        <Chip color={chip.color} label={chip.label} size="small" variant="outlined" />
        {live.loadingOlder && (
          <Typography color="text.secondary" variant="caption">
            Loading older candles…
          </Typography>
        )}
        {live.reachedStart && (
          <Typography color="text.secondary" variant="caption">
            Start of history
          </Typography>
        )}
      </Box>
      {live.error && <Alert severity="error">{live.error}</Alert>}
      <Box ref={chartBoxRef} sx={{ position: "relative" }}>
        {live.loading && (
          <Box sx={{ display: "flex", justifyContent: "center", left: 0, position: "absolute", right: 0, top: 80, zIndex: 4 }}>
            <CircularProgress />
          </Box>
        )}
        <IndicatorLegend
          hasEntryAnchor={false}
          hasVPoints={vPointTimes.length > 0}
          indicators={indicators}
          sourceCandles={overlays.sourceCandles}
        />
        <CurrencyChart
          data={live.candles}
          entryOrders={[]}
          followLatest
          height={height}
          markers={markers}
          onNearLeftEdge={live.loadOlder}
          overlayBands={overlays.overlayBands}
          overlayLines={overlays.overlayLines}
        />
      </Box>
    </Box>
  );
}
