/** Independently scheduled production stage. */
export type RuntimeStage =
  | "risk-sentinel"
  | "speedup"
  | "standard-monitoring"
  | "management"
  | "capture-entry";

export const RUNTIME_STAGE_ORDER: RuntimeStage[] = [
  "risk-sentinel",
  "speedup",
  "standard-monitoring",
  "management",
  "capture-entry",
];

export const DEFAULT_SPEEDUP_POSITIVE_PNL_THRESHOLD_PCT = 1.5;
export const DEFAULT_SPEEDUP_NEGATIVE_PNL_THRESHOLD_PCT = 1.5;
export const DEFAULT_SPEEDUP_TAKE_PROFIT_OFFSET_PCT = 0.5;

export const DEFAULT_STAGE_INTERVAL_MINUTES: Record<RuntimeStage, number> = {
  "risk-sentinel": 1,
  speedup: 1,
  "standard-monitoring": 5,
  management: 5,
  "capture-entry": 5,
};

/** One timed section of a completed production cycle. */
export interface RuntimeCycleSectionSummary {
  /** Section key; short because it is persisted in mode memory. */
  s: string;
  /** Total milliseconds spent in this section for the completed cycle. */
  ms: number;
  /** Number of times the section was observed during the completed cycle. */
  n: number;
}

/** Last completed cycle section-duration summary. */
export interface RuntimeCyclePerformanceSummary {
  /** Last completed cycle total duration in milliseconds. */
  totalMs: number;
  /** Timing summary grouped by section, sorted by duration descending. */
  sections: RuntimeCycleSectionSummary[];
}

/** Compact persisted result of one successful production-stage pass. */
export interface RuntimeStageRunStats {
  /** Completion timestamp in milliseconds. */
  t: number;
  /** Total stage duration in milliseconds. */
  ms: number;
  /** Number of symbols eligible for this pass. */
  symbols: number;
  /** Number of execution reports produced by this pass. */
  reports: number;
  /** Human-readable result summary. */
  summary: string;
  /** Section-duration breakdown captured for this pass. */
  performance: RuntimeCyclePerformanceSummary;
}

/** Latest successful pass retained independently for each production stage. */
export type RuntimeStageRunStatsMap = Partial<
  Record<RuntimeStage, RuntimeStageRunStats>
>;

/** Normalizes a stage interval to a positive whole number of minutes. */
function normalizeIntervalMinutes(
  value: unknown,
  fallbackMinutes: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallbackMinutes;
  }

  return Math.max(1, Math.floor(parsed));
}

/** Normalizes a non-negative percentage used by Speedup classification. */
function normalizeSpeedupPercent(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(0, parsed);
}

/** Resolves the configured interval for one production stage. */
function getStageIntervalMinutes(
  runtime: {
    blackSwanStageIntervalMinutes?: unknown;
    captureEntryStageIntervalMinutes?: unknown;
    managementStageIntervalMinutes?: unknown;
    speedupStageIntervalMinutes?: unknown;
    standardMonitoringStageIntervalMinutes?: unknown;
  },
  stage: RuntimeStage,
): number {
  const keyByStage: Record<
    RuntimeStage,
    keyof typeof runtime
  > = {
    "risk-sentinel": "blackSwanStageIntervalMinutes",
    speedup: "speedupStageIntervalMinutes",
    "standard-monitoring": "standardMonitoringStageIntervalMinutes",
    management: "managementStageIntervalMinutes",
    "capture-entry": "captureEntryStageIntervalMinutes",
  };

  return normalizeIntervalMinutes(
    runtime[keyByStage[stage]],
    DEFAULT_STAGE_INTERVAL_MINUTES[stage],
  );
}

/** Grouped production-stage cadence and threshold helpers. */
const runtimeStages = {
  order: RUNTIME_STAGE_ORDER,
  interval: {
    defaults: DEFAULT_STAGE_INTERVAL_MINUTES,
    getMinutes: getStageIntervalMinutes,
    normalizeMinutes: normalizeIntervalMinutes,
  },
  speedupThreshold: {
    defaults: {
      negativePct: DEFAULT_SPEEDUP_NEGATIVE_PNL_THRESHOLD_PCT,
      positivePct: DEFAULT_SPEEDUP_POSITIVE_PNL_THRESHOLD_PCT,
      takeProfitOffsetPct: DEFAULT_SPEEDUP_TAKE_PROFIT_OFFSET_PCT,
    },
    normalizePct: normalizeSpeedupPercent,
  },
} as const;

export default runtimeStages;
export { runtimeStages };
