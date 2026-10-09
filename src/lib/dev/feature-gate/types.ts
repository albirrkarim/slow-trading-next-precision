import type { FeatureGateDatasetRow } from "@/lib/dev/backtestPrecision/feature-gate-dataset";
import type { ExchangeType, MarketType } from "@/lib/system/types";
import type { NumericFilterOperator } from "@/lib/system/utils/numeric-filter";

import type datasetFilters from "./filters";

export type { FeatureGateDatasetRow };

/** One selectable gate version for the evaluation UI. */
export interface FeatureGateInfo {
  slug: string;
  label: string;
  /** Selectable checks, keyed by the ids accepted by evaluation. */
  subGates?: Record<string, string>;
}

/**
 * Miss-score histogram of the accepted resolved rows — one key per exact
 * score present plus the mean and worst score so one glance shows whether
 * accepted entries cluster at clean level-0 reversals or drag losing
 * sequences in.
 */
export interface FeatureGateScoreDistribution {
  /** Exact score → count of accepted resolved rows with that missScore. */
  [score: string]: number | undefined;
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
  /**
   * Top rejection reasons by frequency — the debugging signal. `reason` is
   * the number-stripped template ("envelope is only #% wide") so variants
   * group; `sample` keeps one real reason string for inspection.
   */
  topRejections: { count: number; reason: string; sample: string }[];
}

/** `evaluate` result — one run's dataset scored by one gate version. */
export interface FeatureGateReport {
  /** Accepted resolved rows with score >= 3, captured during this evaluation. Features load through the paginated table. */
  acceptedHighScoreRows?: FeatureGateAcceptedHighScoreRow[];
  hash: string;
  metrics: FeatureGateMetrics;
  slug: string;
  /** Effective selectable checks, including defaults when no selection was supplied. */
  enabledSubGates?: string[];
}

/** Compact reference to one accepted outcome that needs manual inspection. */
export interface FeatureGateAcceptedHighScoreRow {
  t: number;
  symbol: string;
  signalId: string;
  missScore: number;
  /** Acceptance explanation from the same gate invocation that counted this row. */
  message: string;
}

/** One backtest run that produced a feature-gate dataset. */
export interface FeatureGateDatasetOption {
  /** Simulated window timestamps after symbol-availability intersection. */
  datasetWindow?: { endTime: number; startTime: number };
  hash: string;
  /** Exchange the run traded on — from the run meta. */
  exchangeType: ExchangeType;
  /** Market the run traded — derived from `management.tradingMode`. */
  marketType: MarketType;
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
export type FeatureGateRowMetric = keyof typeof datasetFilters.metrics;

/** Filter/pagination input for the dataset-rows endpoint. Conditions combine with AND. */
export interface FeatureGateRowQuery {
  hash: string;
  /** Inclusive capture-time bounds (Unix ms). Missing capture times never match. */
  fromT?: number;
  toT?: number;
  /** Numeric condition; all three fields are supplied together. Missing metrics never match. */
  metric?: FeatureGateRowMetric;
  operator?: NumericFilterOperator;
  value?: number;
  minMissScore?: number;
  page?: number;
  pageSize?: number;
  /** Sort key — defaults to capture time ascending. */
  sort?: "missScore" | "sequence" | "time";
  order?: "asc" | "desc";
  symbol?: string;
  /** Limit inspection to exact rows counted by a completed evaluation. */
  references?: Pick<FeatureGateAcceptedHighScoreRow, "symbol" | "t" | "signalId">[];
}

/** Paginated dataset-rows response — rows ordered by capture time. */
export interface FeatureGateRowPage {
  /** Unfiltered rows across all symbols — the "n of total" denominator. */
  datasetTotal: number;
  page: number;
  pageSize: number;
  rows: FeatureGateDatasetRow[];
  /** Symbols that produced dataset rows — drives the filter dropdown. */
  symbols: string[];
  total: number;
}
