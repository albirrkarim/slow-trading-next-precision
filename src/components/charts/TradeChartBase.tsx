"use client";

import {
  convertVolatilityToLeveledMarkers,
  convertVolatilityToMarkers,
  type Marker,
  type MultiLinePair,
} from "@/lib/system/utils/ui/chart-markers";
import { endpoints } from "@/components/endpoints";
import MultiLineTimelined from "@/components/ui/Chart/MultiLineTimelined";
import HeaderMetrics from "@/components/ui/HeaderMetrics";
import type { IntervalKlines } from "@/lib/exchange";

import { systemLog } from "@/lib/system/logging";
import type { Position } from "@/lib/system/trading";
import {
  Box,
  CircularProgress,
  MenuItem,
  Select,
  Typography,
} from "@mui/material";
import axios from "axios";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CurrencyChart from "./CurrencyChart";
import IndicatorLegend from "./indicators/IndicatorLegend";
import IndicatorsMenu from "./indicators/IndicatorsMenu";
import { useChartIndicators } from "./indicators/useChartIndicators";
import { useChartOverlays } from "./indicators/useChartOverlays";
import { useFillHeight } from "./useFillHeight";
import type { VolatilityPoint } from "@/lib/system/types";
import type { FeatureIndicatorDefs } from "@/lib/features/indicators";

type TrajectoryPoint = {
  price: number;
  scenario?: string;
  time: number;
};

type TradeChartPosition = Pick<
  Position<any>,
  "exposure" | "opened" | "strategy"
>;

type KlinesResponse = {
  klines: any[];
  markers?: Marker[];
  priceSeries?: MultiLinePair;
  vPointsSeries?: MultiLinePair;
};

type TradeChartVolatilitySource = "generated" | "storage";

const TRADE_CHART_INTERVAL_OPTIONS: IntervalKlines[] = [
  "1m",
  "5m",
  "15m",
  "1h",
  "4h",
  "1w",
];

function getRangeForInterval(interval: IntervalKlines): string {
  switch (interval) {
    case "1m":
      return "1month";
    case "5m":
      return "2month";
    case "15m":
      return "3month";
    case "1h":
      return "6month";
    case "4h":
      return "1year";
    case "1w":
      return "3year";
    default:
      return "6month";
  }
}

export default function TradeChartBase({
  activePosition,
  symbol,
  exchange,
  marketType,
  markers,
  header,
  trajectory,
  trajectoryAnchor,
  trajectoryDirection,
  defaultInterval = "5m",
  defaultShowVolatility = false,
  dashedEntryPriceLine = false,
  includeTradeHistory = false,
  startTimeMs,
  endTimeMs,
  initialVisibleRangeMs,
  volatilitySource = "storage",
  customVolatilityPoints,
  fillHeight = false,
  featureDefs,
}: {
  activePosition?: TradeChartPosition;
  symbol: string;
  exchange: string;
  marketType?: "SPOT" | "FUTURES";
  markers: Marker[];
  header?: ReactNode;
  trajectory?: TrajectoryPoint[][];
  trajectoryAnchor?: {
    price: number;
    time: number;
  };
  trajectoryDirection?: "LONG" | "SHORT";
  defaultInterval?: IntervalKlines;
  defaultShowVolatility?: boolean;
  dashedEntryPriceLine?: boolean;
  includeTradeHistory?: boolean;
  startTimeMs?: number;
  endTimeMs?: number;
  /** Trade window (ms) the chart scrolls to when data first loads. */
  initialVisibleRangeMs?: { start: number; end: number };
  volatilitySource?: TradeChartVolatilitySource;
  customVolatilityPoints?: VolatilityPoint[];
  /** Stretch the chart to the viewport bottom (fullscreen dialogs). */
  fillHeight?: boolean;
  /** Indicator definitions captured with the trade/row — "Add from features". */
  featureDefs?: FeatureIndicatorDefs;
}) {
  const [klines, setKlines] = useState<any[]>([]);
  const [apiMarkers, setApiMarkers] = useState<Marker[]>([]);
  const [vPointsSeries, setVPointsSeries] = useState<MultiLinePair | undefined>(
    undefined,
  );
  const [priceSeries, setPriceSeries] = useState<MultiLinePair | undefined>(
    undefined,
  );
  const [vPointTimes, setVPointTimes] = useState<number[]>([]);
  const [interval, setInterval] = useState<IntervalKlines>(defaultInterval);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const indicators = useChartIndicators();
  const chartBoxRef = useRef<HTMLDivElement>(null);
  // Reserve room below for the collapsed Volatility Points header.
  const chartHeight = useFillHeight(chartBoxRef, {
    enabled: fillHeight,
    fallback: 500,
    reserve: 72,
  });

  useEffect(() => {
    setInterval(defaultInterval);
  }, [defaultInterval, exchange, symbol]);

  const fetchKlines = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get<KlinesResponse>(
        endpoints.market.klines,
        {
          params: {
            symbol,
            interval,
            exchange: exchange || "okx",
            marketType: marketType || "FUTURES",
            ...(typeof startTimeMs === "number" &&
              Number.isFinite(startTimeMs) &&
              typeof endTimeMs === "number" &&
              Number.isFinite(endTimeMs) &&
              endTimeMs > startTimeMs
              ? {
                startTime: Math.round(startTimeMs),
                endTime: Math.round(endTimeMs),
              }
              : {
                range: getRangeForInterval(interval),
              }),
            upToDateKlines: true,
            volatility: customVolatilityPoints === undefined,
            volatilitySource,
            tradeHistory: includeTradeHistory,
          },
        },
      );

      const rawData = res.data.klines;
      if (Array.isArray(rawData)) {
        const formattedData = rawData.map((k: any[]) => ({
          time: k[0] / 1000,
          open: Number(k[1]),
          high: Number(k[2]),
          low: Number(k[3]),
          close: Number(k[4]),
          volume: Number(k[5]),
        }));
        setKlines(formattedData);
      }

      const visibleCustomVolatilityPoints =
        customVolatilityPoints === undefined
          ? undefined
          : (() => {
              const firstTime = Number(rawData[0]?.[0]);
              const lastTime = Number(rawData.at(-1)?.[0]);
              if (!Number.isFinite(firstTime) || !Number.isFinite(lastTime)) {
                return [];
              }

              return customVolatilityPoints.filter(
                (point) => point.t >= firstTime && point.t <= lastTime,
              );
            })();

      const nextMarkers = [
        ...((res.data?.markers ?? []) as Marker[]),
        ...(visibleCustomVolatilityPoints
          ? convertVolatilityToMarkers(visibleCustomVolatilityPoints)
          : []),
      ];
      setApiMarkers(Array.isArray(nextMarkers) ? nextMarkers : []);

      if (visibleCustomVolatilityPoints) {
        setVPointsSeries({
          names: [symbol],
          series: [
            convertVolatilityToLeveledMarkers(
              symbol,
              visibleCustomVolatilityPoints,
            ),
          ],
        });
        setVPointTimes(visibleCustomVolatilityPoints.map((point) => point.t));
      } else if (res.data.vPointsSeries?.series?.length) {
        setVPointsSeries(res.data.vPointsSeries);
        // Leveled markers carry chart seconds — normalize back to ms.
        setVPointTimes(
          (res.data.vPointsSeries.series[0] ?? []).map(
            (marker) => marker.time * 1000,
          ),
        );
      } else {
        setVPointsSeries(undefined);
        setVPointTimes([]);
      }

      if (res.data.priceSeries?.series?.length) {
        setPriceSeries(res.data.priceSeries);
      } else {
        setPriceSeries(undefined);
      }
    } catch (err) {
      systemLog.error("Failed to fetch klines for trade chart", err);
      setError("Failed to load chart data");
    } finally {
      setLoading(false);
    }
  }, [
    endTimeMs,
    exchange,
    includeTradeHistory,
    interval,
    marketType,
    startTimeMs,
    symbol,
    volatilitySource,
    customVolatilityPoints,
  ]);

  useEffect(() => {
    fetchKlines();
  }, [fetchKlines]);

  const showVPoints = indicators.config.vPoints;
  const allMarkers = useMemo(
    () => [
      ...(showVPoints
        ? apiMarkers
        : apiMarkers.filter((marker) => marker.kind !== "vpoint")),
      ...(markers ?? []),
    ],
    [apiMarkers, markers, showVPoints],
  );
  const initialVisibleRange = useMemo(
    () =>
      initialVisibleRangeMs &&
      Number.isFinite(initialVisibleRangeMs.start) &&
      Number.isFinite(initialVisibleRangeMs.end) &&
      initialVisibleRangeMs.end > initialVisibleRangeMs.start
        ? {
            from: Math.floor(initialVisibleRangeMs.start / 1000),
            to: Math.ceil(initialVisibleRangeMs.end / 1000),
          }
        : undefined,
    [initialVisibleRangeMs?.end, initialVisibleRangeMs?.start],
  );

  const entryAnchorMs = activePosition?.opened.t;
  const hasEntryAnchor =
    typeof entryAnchorMs === "number" &&
    Number.isFinite(entryAnchorMs) &&
    entryAnchorMs > 0;
  const overlays = useChartOverlays({
    indicators,
    candles: klines,
    symbol,
    exchange,
    marketType,
    vPointTimes,
    entryAnchorMs: hasEntryAnchor ? entryAnchorMs : undefined,
  });
  const hasVPoints = vPointTimes.length > 0;

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ py: 4, textAlign: "center" }}>
        <Typography color="error">{error}</Typography>
      </Box>
    );
  }

  return (
    <Box>
      {header ? (
        <Box
          sx={{
            mb: 1,
            display: "flex",
            gap: 2,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          {header}
        </Box>
      ) : null}

      <Box
        sx={{
          mb: 1.5,
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          gap: 1,
          flexWrap: "wrap",
        }}
      >
        <IndicatorsMenu
          featureDefs={featureDefs}
          hasVPoints={hasVPoints}
          indicators={indicators}
        />
        <Select
          value={interval}
          onChange={(event) => setInterval(event.target.value as IntervalKlines)}
          size="small"
          variant="outlined"
          sx={{ minWidth: 96, height: 34, fontSize: "0.875rem" }}
          title="Change trade chart interval"
        >
          {TRADE_CHART_INTERVAL_OPTIONS.map((option) => (
            <MenuItem key={option} value={option}>
              {option}
            </MenuItem>
          ))}
        </Select>
      </Box>

      <Box ref={chartBoxRef} sx={{ position: "relative" }}>
        <IndicatorLegend
          sourceCandles={overlays.sourceCandles}
          hasEntryAnchor={hasEntryAnchor}
          hasVPoints={hasVPoints}
          indicators={indicators}
        />
        <CurrencyChart
          data={klines}
          markers={allMarkers}
          activePosition={activePosition}
          dashedEntryPriceLine={dashedEntryPriceLine}
          entryOrders={[]}
          height={chartHeight}
          initialVisibleRange={initialVisibleRange}
          trajectory={trajectory}
          trajectoryAnchor={trajectoryAnchor}
          trajectoryDirection={trajectoryDirection}
          overlayLines={overlays.overlayLines}
          overlayBands={overlays.overlayBands}
        />
      </Box>

      {vPointsSeries && (
        <HeaderMetrics
          defaultExpanded={defaultShowVolatility}
          title={<>Volatility Points ({vPointsSeries.series[0]?.length ?? 0})</>}
          sx={{ my: 2 }}
        >
          {(expanded) => (
            <>
              {expanded && (
                <MultiLineTimelined
                  series={vPointsSeries.series}
                  names={vPointsSeries.names}
                />
              )}
            </>
          )}
        </HeaderMetrics>
      )}
    </Box>
  );
}
