"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import axios from "axios";

import {
  convertPositionIntoEntryExitPair,
  type LeveledMarkers,
} from "@/lib/system/utils/ui/chart-markers";
import { DEFAULT_COLORS } from "@/lib/system/utils/ui/colors";
import { endpoints } from "@/components/endpoints";
import type { BlackSwanTimelineVisibleRange } from "@/components/reports/BlackSwanTimeline";

import type { UnifiedFundingRate } from "@/lib/exchange";

import { systemLog } from "@/lib/system/logging";

import { delayExecution, queueExecution } from "@/components/client/utils";
import { DASHBOARD_POLL_INTERVAL_MS } from "../constants";
import { applyTimeWindowClient, makeSeries } from "@/lib/system/utils/ui/series";
import { calculateTimeRange } from "@/lib/system/utils/ui/time-range";
import type { RuntimeBinanceHealthSnapshot } from "@/lib/system/storage";
import type { RuntimeDashboardState } from "@/lib/system/dashboard";
import type { VolatilityPoint } from "@/lib/system/types";

import type {
  DashboardConfig,
  KlineMarker,
  QuickBacktestSimulationSeries,
} from "./types";
import { applyQuickBacktestSimulationToChartData } from "./utils";

export default function useDashboardData() {
  const [symbols, setSymbols] = useState<string[]>([]);
  const [data, setData] = useState<KlineMarker | null>(null);
  const [volatilityMap, setVolatilityMap] = useState<Record<
    string,
    VolatilityPoint[]
  > | null>(null);
  const [loading, setLoading] = useState(false);
  const [reinitializing, setReinitializing] = useState(false);
  const [volume24hBySymbol, setVolume24hBySymbol] = useState<
    Record<string, number>
  >({});
  const [marketCapUSDBySymbol, setMarketCapUSDBySymbol] = useState<
    Record<string, number>
  >({});
  const [marketCapFetchedAtBySymbol, setMarketCapFetchedAtBySymbol] = useState<
    Record<string, number>
  >({});
  const [fundingRateBySymbol, setFundingRateBySymbol] = useState<
    Record<string, UnifiedFundingRate>
  >({});
  const [dashboardState, setDashboardState] =
    useState<RuntimeDashboardState | null>(null);
  const [storedAccountSlug, setStoredAccountSlug] = useState<string | null>(
    null,
  );
  const [volatilityVisibleRange, setVolatilityVisibleRange] = useState<
    { mode: string | undefined; range: BlackSwanTimelineVisibleRange } | undefined
  >(undefined);
  const activeMode = dashboardState?.activeMode;
  const onVolatilityVisibleRange = useCallback(
    (range: BlackSwanTimelineVisibleRange) =>
      setVolatilityVisibleRange({ mode: activeMode, range }),
    [activeMode],
  );
  const volatilityRange =
    volatilityVisibleRange && volatilityVisibleRange.mode === activeMode
      ? volatilityVisibleRange.range
      : undefined;

  useEffect(() => {
    const stored = window.localStorage.getItem("slow-selected-account");
    if (stored) setStoredAccountSlug(stored);
  }, []);

  const dashboardAccounts = dashboardState?.accounts ?? [];
  // Accounts participating in the paired view: enabled, plus the dashboard
  // account filter when one is selected.
  const participatingAccountSlugs = dashboardAccounts
    .filter(
      (account) =>
        account.enabled &&
        (!dashboardState?.accountFilter ||
          account.slug === dashboardState.accountFilter),
    )
    .map((account) => account.slug);
  const accountEntryLegs = useMemo(
    () =>
      Object.fromEntries(
        (dashboardState?.accounts ?? []).map((account) => [
          account.slug,
          account.trading.entryLegs ?? "BOTH",
        ]),
      ),
    [dashboardState?.accounts],
  );
  const selectedAccountSlug =
    storedAccountSlug &&
    dashboardAccounts.some((account) => account.slug === storedAccountSlug)
      ? storedAccountSlug
      : dashboardAccounts[0]?.slug;

  const setSelectedAccountSlug = (slug: string) => {
    setStoredAccountSlug(slug);
    window.localStorage.setItem("slow-selected-account", slug);
  };
  const [quickSimulationSeries, setQuickSimulationSeries] =
    useState<QuickBacktestSimulationSeries>({
      names: [],
      series: [],
    });
  const [config, setConfig] = useState<DashboardConfig>({
    range: "1month",
    startTime: undefined,
    endTime: undefined,
  });

  function updateConfig(update: Partial<DashboardConfig>) {
    setConfig((prev) => ({ ...prev, ...update }));
  }

  function applyDashboardState(nextState: RuntimeDashboardState) {
    setDashboardState(nextState);

    const symbolsLocal = Array.from(
      new Set([...nextState.config.symbols, "BTC"]),
    );
    setSymbols(symbolsLocal);

    return symbolsLocal;
  }

  function applyBinanceHealth(health: RuntimeBinanceHealthSnapshot) {
    setDashboardState((current) =>
      current ? { ...current, binanceHealth: health } : current,
    );
  }

  const execute = async (reinitialize = false) => {
    if (reinitialize) {
      setReinitializing(true);
    } else {
      setLoading(true);
    }

    try {
      setData(null);

      const stateResp = await axios.get<RuntimeDashboardState>(
        endpoints.system.state,
      );
      const nextState = stateResp.data;
      const exchangeType = nextState.config.exchangeType;
      const symbolsLocal = applyDashboardState(nextState);

      const initialization = await axios.post<{
        data: {
          fundingRateBySymbol?: Record<string, UnifiedFundingRate>;
          marketCapFetchedAtBySymbol?: Record<string, number>;
          marketCapUSDBySymbol?: Record<string, number>;
          volume24hBySymbol?: Record<string, number>;
        };
      }>(endpoints.market.initialize, {
        symbols: symbolsLocal,
        reinitialize,
        exchangeType,
        verbose: true,
        logCategories: [],
      });
      setMarketCapUSDBySymbol(
        initialization.data.data.marketCapUSDBySymbol ?? {},
      );
      setFundingRateBySymbol(
        initialization.data.data.fundingRateBySymbol ?? {},
      );
      setMarketCapFetchedAtBySymbol(
        initialization.data.data.marketCapFetchedAtBySymbol ?? {},
      );
      setVolume24hBySymbol(initialization.data.data.volume24hBySymbol ?? {});

      const resp1 = await axios.post<{
        data: Record<string, VolatilityPoint[]>;
        series: LeveledMarkers[][];
      }>(endpoints.market.volatility, {
        symbols: symbolsLocal,
        range: config.range,
        startTime: config.startTime,
        endTime: config.endTime,
        verbose: true,
        logCategories: [],
        exchangeType,
      });

      const vMap = resp1.data.data;
      setVolatilityMap(vMap);

      const { series, markers } = makeSeries(vMap, DEFAULT_COLORS);

      const colorMapContrast = Object.fromEntries(
        symbolsLocal.map((symbol, index) => [
          symbol,
          DEFAULT_COLORS[index % DEFAULT_COLORS.length],
        ]),
      );

      const chartPositions = [...nextState.history, ...nextState.openPositions];

      const tradePairs = convertPositionIntoEntryExitPair({
        positions: chartPositions,
        colorMap: colorMapContrast,
      });

      const names = [...symbolsLocal];
      for (const item of tradePairs) {
        names.push(`TRADE ${item[0].symbol}`);
      }

      const entrySignals = resp1.data.series;

      if (config.startTime && config.endTime) {
        applyTimeWindowClient(
          series,
          config.startTime / 1000,
          config.endTime / 1000,
          true,
        );

        applyTimeWindowClient(
          tradePairs,
          config.startTime / 1000,
          config.endTime / 1000,
          true,
        );

        applyTimeWindowClient(
          entrySignals,
          config.startTime / 1000,
          config.endTime / 1000,
          true,
        );
      }

      const entryDots = entrySignals.flat().map((item) => [item]);
      names.push(
        ...entryDots.map(
          (item) => `ENTRY ${item[0].level > 0 ? "SHORT" : "LONG"}`,
        ),
      );

      const finalSeries = [...series, ...tradePairs, ...entryDots];

      const chartData = {
        symbols: symbolsLocal,
        series: finalSeries,
        names,
        markers,
      };

      setData(
        applyQuickBacktestSimulationToChartData(
          chartData,
          quickSimulationSeries,
        ),
      );

      systemLog.log({ vMap, tradeHistory: nextState.history, series });
    } catch (error) {
      systemLog.error(error);
      alert(reinitialize ? "Reinitialize failed" : "Execution failed");
    } finally {
      if (reinitialize) {
        setReinitializing(false);
      } else {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    delayExecution(
      () => {
        queueExecution(() => execute(), 500, "dashboard");
      },
      500,
      "home",
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  useEffect(() => {
    const { startTime, endTime } = calculateTimeRange(config.range);
    updateConfig({ startTime, endTime });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let isActive = true;

    const refreshDashboardState = async () => {
      try {
        const stateResp = await axios.get<RuntimeDashboardState>(
          endpoints.system.state,
        );

        if (!isActive) {
          return;
        }

        applyDashboardState(stateResp.data);
        try {
          const fundingResponse = await axios.post<{
            data: {
              fundingRateBySymbol?: Record<string, UnifiedFundingRate>;
            };
          }>(endpoints.market.fundingRates, {
            exchangeType: stateResp.data.config.exchangeType,
            symbols: Array.from(
              new Set([...stateResp.data.config.symbols, "BTC"]),
            ),
          });

          if (isActive) {
            setFundingRateBySymbol(
              fundingResponse.data.data.fundingRateBySymbol ?? {},
            );
          }
        } catch (error) {
          systemLog.error(error);
        }
      } catch (error) {
        systemLog.error(error);
      }
    };

    const intervalId = window.setInterval(() => {
      void refreshDashboardState();
    }, DASHBOARD_POLL_INTERVAL_MS);

    return () => {
      isActive = false;
      window.clearInterval(intervalId);
    };
  }, []);

  const currentExchangeType =
    dashboardState?.config.exchangeType ?? "tokocrypto";

  const applyQuickBacktestSimulationSeries = (
    simulationSeries: QuickBacktestSimulationSeries,
  ) => {
    setQuickSimulationSeries(simulationSeries);
    setData((current) => {
      if (!current) return current;
      return applyQuickBacktestSimulationToChartData(current, simulationSeries);
    });
  };

  return {
    accountEntryLegs,
    applyBinanceHealth,
    applyDashboardState,
    applyQuickBacktestSimulationSeries,
    config,
    currentExchangeType,
    dashboardState,
    data,
    execute,
    fundingRateBySymbol,
    loading,
    marketCapFetchedAtBySymbol,
    marketCapUSDBySymbol,
    onVolatilityVisibleRange,
    participatingAccountSlugs,
    reinitializing,
    selectedAccountSlug,
    setSelectedAccountSlug,
    setVolatilityMap,
    symbols,
    updateConfig,
    volatilityMap,
    volatilityRange,
    volume24hBySymbol,
  };
}
