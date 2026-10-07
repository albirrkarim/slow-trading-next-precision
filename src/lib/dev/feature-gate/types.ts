import type { FeatureGateDatasetRow } from "@/lib/dev/backtestPrecision/feature-gate-dataset";

export type { FeatureGateDatasetRow };

/** One selectable gate version for the evaluation UI. */
export interface FeatureGateInfo {
  slug: string;
  label: string;
}

/**
 * Miss-score histogram of the accepted resolved rows — `0`/`1`/`2`/`3+`
 * counts plus the mean and worst score so one glance shows whether accepted
 * entries cluster at clean level-0 reversals or drag losing sequences in.
 */
export interface FeatureGateScoreDistribution {
  "0": number;
  "1": number;
  "2": number;
  "3+": number;
  /** Mean missScore across accepted resolved rows; absent when none exist. */
  avgScore?: number;
  /** Highest missScore among accepted resolved rows; absent when none. */
  worstScore?: number;
}

/** Per-symbol row tallies behind one dataset evaluation. */
export interface FeatureGateSymbolCounts {
  accepted: number;
  resolved: number;
  total: number;
}

/**
 * Metrics for one dataset scored against one gate — the evaluation
 * vocabulary from docs/STRATEGY/FEATURE_EXTRACTION.md. Ratios stay
 * undefined when their denominator is zero (no resolved/ score-0/score+
 * rows) so the UI can render "n/a" instead of a misleading 0 or 1.
 */
export interface FeatureGateMetrics {
  /** Rows without capture inputs or with invalid outcome labels. */
  skipped: number;
  /** Captured, evaluable rows, resolved and unresolved (excludes skipped). */
  total: number;
  /** Rows closed by a reversal — the only ones carrying a missScore. */
  resolved: number;
  /** Rows the gate let through (undefined return). */
  accepted: number;
  /** Rows the gate refused with a reason. */
  rejected: number;
  /** accepted / total. */
  acceptanceRate: number;
  /** accepted score-0 rows / accepted resolved rows. */
  acceptedQuality?: number;
  /** accepted score-0 rows / all score-0 rows. */
  goodRetained?: number;
  /** rejected score-positive rows / all score-positive rows. */
  badBlocked?: number;
  acceptedScoreDistribution: FeatureGateScoreDistribution;
  bySymbol: Record<string, FeatureGateSymbolCounts>;
  /** Top rejection reasons by frequency — the debugging signal. */
  topRejections: { count: number; reason: string }[];
}

/** `evaluate` result — one run's dataset scored by one gate version. */
export interface FeatureGateReport {
  hash: string;
  metrics: FeatureGateMetrics;
  slug: string;
}

/** One backtest run that produced a feature-gate dataset. */
export interface FeatureGateDatasetOption {
  /** Simulated window timestamps after symbol-availability intersection. */
  datasetWindow?: { endTime: number; startTime: number };
  hash: string;
  /** Symbols the run traded — from the cached request params. */
  coins: string[];
  /** Symbols with captured dataset rows — the dataset/*.json files. */
  datasetSymbols: string[];
  createdAt?: number;
  /** Requested range label ("5year", custom ms window, …). */
  range?: string;
  /** Strategy slug — gate candidates only make sense under the same one. */
  strategy?: string;
}

/** Filter/pagination input for the dataset-rows endpoint. */
export interface FeatureGateRowQuery {
  hash: string;
  minMissScore?: number;
  page?: number;
  pageSize?: number;
  /** `true` keeps only resolved rows. */
  resolved?: boolean;
  symbol?: string;
}

/** Paginated dataset-rows response — rows ordered by capture time. */
export interface FeatureGateRowPage {
  page: number;
  pageSize: number;
  rows: FeatureGateDatasetRow[];
  /** Symbols that produced dataset rows — drives the filter dropdown. */
  symbols: string[];
  total: number;
}
