import type { BalanceSummary, Position } from "@/lib/system/trading";
import type { ExchangeType, VolatilityPoint } from "@/lib/system/types";

/** One account's balance summary captured at a single timestamp. */
export interface BacktestBalanceSnapshot extends BalanceSummary {
  t: number;
}

export interface BacktestPrecisionResult {
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
  exchangeType: ExchangeType;
  counts: BacktestRunCounts;
  summary: BacktestRunSummary;
  /** Written part counts per artifact field, persisted into meta.json. */
  parts: BacktestArtifactManifest;
}
