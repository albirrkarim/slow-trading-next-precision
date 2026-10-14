"use client";

import { Alert, Box, Chip, CircularProgress, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { useMemo, useRef, useState } from "react";

import CurrencyChart from "@/components/charts/CurrencyChart";
import { computePricePrecision } from "@/components/charts/CurrencyChart/precision";
import IndicatorLegend from "@/components/charts/indicators/IndicatorLegend";
import IndicatorsMenu from "@/components/charts/indicators/IndicatorsMenu";
import { useChartIndicators } from "@/components/charts/indicators/useChartIndicators";
import { useChartOverlays } from "@/components/charts/indicators/useChartOverlays";
import { useFillHeight } from "@/components/charts/useFillHeight";
import type { IntervalKlines } from "@/lib/exchange";
import type { Kline } from "@/lib/system/types/market";
import tradePlan, { type TradePlanPoint, type TradePlanSide } from "@/lib/system/utils/ui/trade-plan";
import vpointExcursions from "@/lib/system/utils/ui/vpoint-excursions";
import vpoints from "@/lib/system/utils/vpoints";

import type { LiveMarket } from "./binanceLiveSocket";
import TradePlanButtons from "./TradePlanButtons";
import TradePlanPanel from "./TradePlanPanel";
import { useLiveKlines, type LiveStatus } from "./useLiveKlines";
import { useTradePlanStore } from "./useTradePlanStore";

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
  engineMovePct,
}: {
  symbol: string;
  interval: IntervalKlines;
  market: LiveMarket;
  /** Coin/market/interval pickers rendered at the toolbar's start. */
  controls: ReactNode;
  /** Engine's vPoint move threshold — the stored points' entry-guard reference. */
  engineMovePct: number;
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
  // vPoints: the engine's stored points, or detected fresh over every
  // loaded closed candle with the configured thresholds.
  const vPointSource = indicators.config.vPointSource;
  const freshPoints = useMemo(() => {
    if (vPointSource.mode !== "fresh" || closedCandles.length < 2) return [];
    const klines = closedCandles.map(
      (candle) =>
        [candle.time * 1000, String(candle.open), String(candle.high), String(candle.low),
          String(candle.close), String(candle.volume), candle.time * 1000, "0"] as unknown as Kline,
    );
    return vpoints.detectVPoints({
      klines,
      moveThreshold: vPointSource.move,
      retracePercent: vPointSource.retrace,
      symbol,
    });
  }, [closedCandles, symbol, vPointSource]);
  const points = vPointSource.mode === "fresh" ? freshPoints : live.points;
  const vPointTimes = useMemo(() => points.map((point) => point.t), [points]);
  // Markers carry max excursions; the newest point's run to the live mark,
  // so this follows every tick (a single sweep over the candles).
  const vPointMarkers = useMemo(
    () =>
      vpointExcursions.markers({
        candles: live.candles,
        intervalMs: live.intervalMs,
        moveThresholdPct: vPointSource.mode === "fresh" ? vPointSource.move : engineMovePct,
        points,
      }),
    [engineMovePct, live.candles, live.intervalMs, points, vPointSource],
  );
  const overlays = useChartOverlays({
    candles: closedCandles,
    exchange: "binance",
    indicators,
    marketType: market,
    symbol,
    vPointTimes,
  });
  const markers = useMemo(
    () => (indicators.config.vPoints ? vPointMarkers : []),
    [indicators.config.vPoints, vPointMarkers],
  );
  const chip = STATUS_CHIP[live.status];
  const plans = useTradePlanStore(symbol);
  const lastCandle = live.candles.at(-1);
  const priceDecimals = useMemo(
    () => computePricePrecision({ data: live.candles }),
    // Decimals only depend on the newest candles' tick size.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [closedKey],
  );
  const [placing, setPlacing] = useState<TradePlanSide | null>(null);
  const placePlan = (point: TradePlanPoint, stepMs: number) => {
    if (!placing) return;
    // A new drawing is always shown, even while plans are hidden.
    indicators.setPlan(true);
    plans.add(tradePlan.create({ price: point.price, side: placing, stepMs, t: point.t }));
    setPlacing(null);
  };

  return (
    <Box sx={{ display: "grid", gap: 1 }}>
      <Box sx={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 1 }}>
        {controls}
        <IndicatorsMenu hasVPoints indicators={indicators} />
        <TradePlanButtons disabled={!lastCandle} onPlacingChange={setPlacing} placing={placing} />
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
          hasPlan={plans.plans.length > 0}
          hasVPoints
          indicators={indicators}
          sourceCandles={overlays.sourceCandles}
          vPointSource
        />
        {indicators.config.plan && plans.selected && (
          <TradePlanPanel
            decimals={priceDecimals}
            onChange={plans.replace}
            onClose={() => plans.select(null)}
            onRemove={() => plans.remove(plans.selected!.id)}
            plan={plans.selected}
            symbol={symbol}
          />
        )}
        <CurrencyChart
          data={live.candles}
          entryOrders={[]}
          followLatest
          height={height}
          markers={markers}
          onNearLeftEdge={live.loadOlder}
          onPlaceTradePlan={placePlan}
          onSelectTradePlan={plans.select}
          onTradePlansChange={plans.setAll}
          overlayBands={overlays.overlayBands}
          overlayLines={overlays.overlayLines}
          placingTradePlan={Boolean(placing)}
          selectedTradePlanId={plans.selectedId}
          tradePlans={indicators.config.plan ? plans.plans : undefined}
        />
      </Box>
    </Box>
  );
}
