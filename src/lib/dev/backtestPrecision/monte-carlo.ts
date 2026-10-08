import type { Position } from "@/lib/system/trading";

/**
 * BTEST:MONTE_CARLO — trade-resampling analysis for a finished backtest run.
 * The realized closed positions form the outcome pool; each simulation draws
 * the same count back (iid shuffle, or contiguous `blockSize` chunks that keep
 * regime clustering) and replays one equity curve from the starting balance.
 * Aggregating thousands of paths turns one lucky/unlucky trade order into a
 * drawdown/final-PnL distribution plus a ruin rate.
 */

export interface MonteCarloTrade {
  account: string;
  pnlUsdt: number;
  t: number;
}

export interface MonteCarloPathStats {
  /** Peak-to-trough equity dip in USDT (>= 0). */
  maxDrawdownUsdt: number;
  /** Peak-to-trough dip relative to the running peak equity. */
  maxDrawdownPct: number;
  finalEquityUsdt: number;
  totalPnlUsdt: number;
  /** Longest run of consecutive losing trades in the path. */
  longestLosingStreak: number;
  /** Equity touched zero or below at least once. */
  ruined: boolean;
}

export interface MonteCarloQuantiles {
  p5: number;
  p50: number;
  p95: number;
  max: number;
}

export interface MonteCarloBandPoint {
  /** Trade index along the path (0-based). */
  i: number;
  p5: number;
  p50: number;
  p95: number;
}

export interface MonteCarloHistogramBin {
  from: number;
  to: number;
  count: number;
}

export interface MonteCarloResult {
  /** Realized path stats for the true close-time order — the "actual". */
  actual: MonteCarloPathStats & { curve: number[] };
  /** Share of simulated paths with a smaller max drawdown than the actual. */
  actualDrawdownPercentile: number;
  bands: MonteCarloBandPoint[];
  drawdownUsdt: MonteCarloQuantiles;
  finalPnlUsdt: MonteCarloQuantiles;
  histogram: MonteCarloHistogramBin[];
  iterations: number;
  longestLosingStreak: { p50: number; max: number };
  /** Fraction of simulated paths whose equity hit <= 0. */
  ruinRate: number;
  trades: number;
}

export interface MonteCarloParams {
  /** How many resampled paths to replay. */
  iterations: number;
  /** "block" keeps `blockSize` consecutive trades together per draw. */
  method: "block" | "shuffle";
  blockSize?: number;
  seed?: number;
  startBalanceUsdt: number;
  trades: MonteCarloTrade[];
}

/**
 * Deterministic PRNG (32-bit LCG, Numerical Recipes constants) — a seed
 * makes a rerun reproducible. The multiply stays under 2^53 so the integer
 * state is exact.
 */
function seededRand(seed: number): () => number {
  let state = Math.abs(Math.floor(seed)) % 4294967296;
  if (state <= 0) state += 4294967295;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/** Sorted-array quantile: q in [0, 1], linear position between neighbors. */
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Closed positions in close-time order, reduced to the resampling input. */
function trades(positions: Position[], account?: string): MonteCarloTrade[] {
  return positions
    .filter(
      (position) =>
        position.closed !== undefined &&
        Number.isFinite(position.closed.t) &&
        Number.isFinite(position.pnl?.netUsdt) &&
        (account === undefined || position.account === account),
    )
    .map((position) => ({
      account: position.account,
      pnlUsdt: position.pnl.netUsdt!,
      t: position.closed!.t!,
    }))
    .sort((a, b) => a.t - b.t);
}

/** Replays pnl deltas over the starting balance into path statistics. */
function replay(
  pnls: number[],
  startBalanceUsdt: number,
  keepCurve: boolean,
): MonteCarloPathStats & { curve?: number[] } {
  let equity = startBalanceUsdt;
  let peak = startBalanceUsdt;
  let maxDrawdownUsdt = 0;
  let maxDrawdownPct = 0;
  let losing = 0;
  let longestLosingStreak = 0;
  let ruined = false;
  const curve = keepCurve ? [equity] : undefined;
  for (const pnl of pnls) {
    equity += pnl;
    if (equity > peak) peak = equity;
    const dip = peak - equity;
    if (dip > maxDrawdownUsdt) {
      maxDrawdownUsdt = dip;
      maxDrawdownPct = peak > 0 ? dip / peak : 0;
    }
    if (pnl < 0) {
      losing += 1;
      if (losing > longestLosingStreak) longestLosingStreak = losing;
    } else {
      losing = 0;
    }
    if (equity <= 0) ruined = true;
    curve?.push(equity);
  }
  return {
    curve,
    finalEquityUsdt: equity,
    longestLosingStreak,
    maxDrawdownPct,
    maxDrawdownUsdt,
    ruined,
    totalPnlUsdt: equity - startBalanceUsdt,
  };
}

/** Draws one resampled pnl sequence of length n from the trade pool. */
function samplePnls(
  pnls: number[],
  method: MonteCarloParams["method"],
  blockSize: number,
  rand: () => number,
): number[] {
  const n = pnls.length;
  const out: number[] = [];
  if (method === "block") {
    const size = Math.max(1, Math.min(blockSize, n));
    const starts = n - size + 1;
    while (out.length < n) {
      const start = Math.floor(rand() * starts);
      for (let i = 0; i < size && out.length < n; i += 1) {
        out.push(pnls[start + i]);
      }
    }
    return out;
  }
  while (out.length < n) out.push(pnls[Math.floor(rand() * n)]);
  return out;
}

const BAND_CURVES = 300;
const HISTOGRAM_BINS = 40;

/** Runs the resampling study and aggregates path statistics. */
function simulate(params: MonteCarloParams): MonteCarloResult {
  const { iterations, method, startBalanceUsdt, trades: pool } = params;
  const pnls = pool.map((trade) => trade.pnlUsdt);
  const n = pnls.length;
  const blockSize =
    params.blockSize ?? Math.max(2, Math.round(Math.sqrt(n)));
  const rand =
    params.seed !== undefined ? seededRand(params.seed) : Math.random;

  const actual = replay(pnls, startBalanceUsdt, true);

  const drawdowns: number[] = [];
  const finalPnls: number[] = [];
  const streaks: number[] = [];
  const curves: number[][] = [];
  let ruined = 0;

  for (let i = 0; i < iterations; i += 1) {
    const sample = samplePnls(pnls, method, blockSize, rand);
    const stats = replay(sample, startBalanceUsdt, i < BAND_CURVES);
    drawdowns.push(stats.maxDrawdownUsdt);
    finalPnls.push(stats.totalPnlUsdt);
    streaks.push(stats.longestLosingStreak);
    if (stats.ruined) ruined += 1;
    if (stats.curve) curves.push(stats.curve);
  }

  drawdowns.sort((a, b) => a - b);
  finalPnls.sort((a, b) => a - b);
  streaks.sort((a, b) => a - b);

  // Per-step equity quantiles across the first BAND_CURVES stored paths.
  const bands: MonteCarloBandPoint[] = [];
  if (curves.length > 0) {
    const stepValues: number[] = new Array(curves.length);
    for (let i = 0; i <= n; i += 1) {
      for (let c = 0; c < curves.length; c += 1) {
        stepValues[c] = curves[c][i];
      }
      stepValues.sort((a, b) => a - b);
      bands.push({
        i,
        p5: quantile(stepValues, 0.05),
        p50: quantile(stepValues, 0.5),
        p95: quantile(stepValues, 0.95),
      });
    }
  }

  const lo = drawdowns[0];
  const hi = drawdowns[drawdowns.length - 1];
  const width = hi > lo ? (hi - lo) / HISTOGRAM_BINS : 1;
  const histogram: MonteCarloHistogramBin[] = Array.from(
    { length: HISTOGRAM_BINS },
    (_, i) => ({ count: 0, from: lo + i * width, to: lo + (i + 1) * width }),
  );
  for (const dd of drawdowns) {
    const index = Math.min(
      HISTOGRAM_BINS - 1,
      Math.floor((dd - lo) / width),
    );
    histogram[index].count += 1;
  }

  const below = drawdowns.filter((dd) => dd < actual.maxDrawdownUsdt).length;

  return {
    actual: { ...actual, curve: actual.curve ?? [] },
    actualDrawdownPercentile: drawdowns.length > 0 ? below / drawdowns.length : 0,
    bands,
    drawdownUsdt: {
      max: hi,
      p5: quantile(drawdowns, 0.05),
      p50: quantile(drawdowns, 0.5),
      p95: quantile(drawdowns, 0.95),
    },
    finalPnlUsdt: {
      max: finalPnls[finalPnls.length - 1] ?? 0,
      p5: quantile(finalPnls, 0.05),
      p50: quantile(finalPnls, 0.5),
      p95: quantile(finalPnls, 0.95),
    },
    histogram,
    iterations,
    longestLosingStreak: {
      max: streaks[streaks.length - 1] ?? 0,
      p50: quantile(streaks, 0.5),
    },
    ruinRate: iterations > 0 ? ruined / iterations : 0,
    trades: n,
  };
}

const monteCarlo = { replay, simulate, trades };

export default monteCarlo;
