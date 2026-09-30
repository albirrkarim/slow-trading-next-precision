import type { CoinTagState } from "@/lib/dev/coins/tag-types";
import type { LeveledMarkers } from "@/lib/system/utils/ui/chart-markers";

import type { KlineMarker, QuickBacktestSimulationSeries } from "./types";

export const EMPTY_COIN_METADATA: CoinTagState = {
  coinDescriptions: {},
  coinTags: {},
  tags: [],
};

/** Checks that an API response has the collections required by the dashboard. */
export function isCoinTagState(value: unknown): value is CoinTagState {
  if (!value || typeof value !== "object") return false;

  const state = value as Partial<CoinTagState>;
  return (
    Boolean(state.coinDescriptions) &&
    typeof state.coinDescriptions === "object" &&
    Boolean(state.coinTags) &&
    typeof state.coinTags === "object" &&
    Array.isArray(state.tags)
  );
}

/**
 * Merges Quick Backtest simulation lines into the volatility chart while
 * keeping simulated trades colored exactly like their base vPoint coin line.
 */
export function applyQuickBacktestSimulationToChartData(
  chartData: KlineMarker,
  simulationSeries: QuickBacktestSimulationSeries,
): KlineMarker {
  const coinColorMap: Record<string, string> = {};
  const keptSeries: LeveledMarkers[][] = [];
  const keptNames: string[] = [];

  chartData.names.forEach((name, index) => {
    if (!name.startsWith("TRADE ") && !name.startsWith("ENTRY ")) {
      const color = chartData.series[index]?.[0]?.color;
      if (color) {
        coinColorMap[name.trim().toUpperCase()] = color;
      }
    }

    if (!name.startsWith("TRADE SIMULATION")) {
      keptNames.push(name);
      keptSeries.push(chartData.series[index]);
    }
  });

  const coloredSimulationSeries = simulationSeries.series.map(
    (seriesItem, index) => {
      const symbol = simulationSeries.names[index]
        ?.replace(/^TRADE SIMULATION\s+/, "")
        .trim()
        .toUpperCase();
      const color = coinColorMap[symbol];

      return color
        ? seriesItem.map((point) => ({ ...point, color }))
        : seriesItem;
    },
  );

  return {
    ...chartData,
    names: [...keptNames, ...simulationSeries.names],
    series: [...keptSeries, ...coloredSimulationSeries],
  };
}
