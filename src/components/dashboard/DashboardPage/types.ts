import type {
  LeveledMarkers,
  Marker,
} from "@/lib/system/utils/ui/chart-markers";

export interface DashboardConfig {
  range: string;
  startTime?: number;
  endTime?: number;
}

export type QuickBacktestSimulationSeries = {
  names: string[];
  series: LeveledMarkers[][];
};

export type KlineMarker = {
  symbols: string[];
  series: LeveledMarkers[][];
  names: string[];
  markers: Marker[][];
};
