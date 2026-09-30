import type { BalanceSummary, Position } from "@/lib/system/trading";
import type {
  BlackSwanTimeline,
  BlackSwanTransition,
} from "@/lib/system/trading/black-swan";
import type { ExchangeType, VolatilityPoint } from "@/lib/system/types";

/**
 * Milliseconds of dataset history consumed before the simulated clock starts —
 * the engine builds the initial vPointsMap from ~2 months of klines, so the
 * effective tradable window is `datasetStart + VPOINT_WARMUP_MS` → `endTime`.
 */
export const VPOINT_WARMUP_MS = 2 * 30 * 24 * 60 * 60_000;

/** One account's balance summary captured at a single timestamp. */
export interface BacktestBalanceSnapshot extends BalanceSummary {
  t: number;
}

export type BacktestBlackSwanTransition = BlackSwanTransition;
export type BacktestBlackSwanTimeline = BlackSwanTimeline;

export interface BacktestPrecisionResult {
  /**
   * Recorded Black Swan status transitions at detector evaluation times.
   * Absent on precision-checker replays and legacy cache entries.
   */
  blackSwanTimeline?: BacktestBlackSwanTimeline;
  exchangeType: ExchangeType;
  vPointsMap: Record<string, VolatilityPoint[]>;
  positions: Position[];
  /** Per-account balance timelines keyed by account slug. */
  balanceSnapshots: Record<string, BacktestBalanceSnapshot[]>;
}

/**
 * Directory where run artifacts are spooled in fixed-size parts. When present
 * on the params, `precisionBacktest` streams positions, vPoints, and balance
 * snapshots to disk instead of retaining them for the whole run and resolves
 * to `BacktestChunkedResult`.
 */
export interface BacktestArtifactTarget {
  /** Absolute directory inside the backtest result cache root. */
  dir: string;
  /** Records written per part file. Defaults to 500. */
  chunkSize?: number;
}

/** Part-file counts per artifact field, recorded in meta.json. */
export interface BacktestArtifactManifest {
  positions: number;
  vpoints: Record<string, number>;
  snapshots: Record<string, number>;
}

/** One named histogram bucket (exit reason or symbol). */
export interface BacktestReasonCount {
  [key: string]: number | string;
  reason: string;
  count: number;
}

/** Per-account exit histograms split by realized pnl sign. */
export interface BacktestExitBuckets {
  profit: BacktestReasonCount[];
  loss: BacktestReasonCount[];
  profitCoins: BacktestReasonCount[];
  lossCoins: BacktestReasonCount[];
}

/** Realized account row: first-to-last balance snapshot plus win/loss tally. */
export interface BacktestAccountSummary {
  slug: string;
  start: number;
  end: number;
  pnlUsdt: number;
  gainPct: number | null;
  wins: number;
  losses: number;
}

/** Compact aggregates emitted with a chunked run; feeds the result summary. */
export interface BacktestRunSummary {
  accounts: BacktestAccountSummary[];
  /** Exit histograms keyed by account slug (closed positions only). */
  exits: Record<string, BacktestExitBuckets>;
}

export interface BacktestRunCounts {
  /** Closed + still-open positions at run end. */
  positions: number;
  closedPositions: number;
  vPoints: number;
  /** Total snapshots across all accounts. */
  snapshots: number;
}

/**
 * Slim result for runs that spooled artifacts to disk. The heavy arrays are
 * served lazily through the backtest detail endpoint instead of the POST body.
 */
export interface BacktestChunkedResult {
  /**
   * Recorded Black Swan status transitions, persisted into meta.json so a
   * cache hit carries them without reading artifact parts.
   */
  blackSwanTimeline?: BacktestBlackSwanTimeline;
  exchangeType: ExchangeType;
  counts: BacktestRunCounts;
  /**
   * Effective dataset window actually simulated — after intersecting every
   * requested symbol's data availability (a later-listed symbol clips the
   * whole run). Persisted into meta.json so readers can distinguish the
   * requested `params.range` from the usable coverage.
   */
  dataset?: { endTime: number; startTime: number };
  summary: BacktestRunSummary;
  /** Written part counts per artifact field, persisted into meta.json. */
  parts: BacktestArtifactManifest;
}
