import type { LeveledMarkers } from "@/lib/system/utils/ui/chart-markers";

export interface VolatilityMultiLineProps {
  series: LeveledMarkers[][];
  names?: string[];
  colors?: string[];
  height?: number;
  defaultShowEntryGroups?: boolean;
  yTickFormatter?: (value: unknown) => string;
  /**
   * Fixed Y-axis pixel width; defaults to Recharts "auto". Set it when
   * stacked charts must keep their plot areas (time axes) aligned.
   */
  yAxisWidth?: number;
  /**
   * Recharts line interpolation for regular series (TRADE/ENTRY groups and
   * "Worker Needed" keep their own). Defaults to "monotone"; step series
   * like the feature stream pass "stepAfter".
   */
  lineType?: "linear" | "monotone" | "stepAfter";
  /** Horizontal guides drawn at y-values, e.g. feature gate bounds. */
  yReferenceLines?: { y: number; label?: string; color?: string }[];
  /** Vertical markers drawn at absolute times, e.g. a recorded window. */
  referenceLines?: { timeMs: number; label?: string; color?: string }[];
  /**
   * Extends the merged data to these absolute times with empty rows so the
   * axis domain and brush strip cover the full frame even when series start
   * later — keeps stacked charts time-aligned (e.g. warm-up vs trading span).
   */
  padStartTimeMs?: number;
  padEndTimeMs?: number;
  /** Initial brush selection bounds as absolute times; snapped to nearest points. */
  brushStartTimeMs?: number;
  brushEndTimeMs?: number;
  /**
   * Reports the visible time domain: the initial full domain (or the
   * brushStart/End-snapped range) once data is loaded, then every brush
   * selection change as the covered point times.
   */
  onVisibleTimeRangeChange?: (range: {
    startTime: number;
    endTime: number;
  }) => void;
}
