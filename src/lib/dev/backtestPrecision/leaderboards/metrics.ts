import type { Position } from "@/lib/system/trading";
import type { VolatilityPoint } from "@/lib/system/types";
import type { BacktestBalanceSnapshot } from "../backtest/backtest-precision-types";
import type {
  BacktestLeaderboardMetrics,
  LeaderboardRange,
} from "./types";

/** Spendable quote below this is treated as an empty trading balance. */
const MINIMAL_SPENDABLE_USDT = 2;
/** Fractional drawdown from a symbol peak that marks a bear window. */
const BEAR_DRAWDOWN_THRESHOLD = 0.2;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const EPS = 1e-9;

interface TimelinePoint {
  t: number;
  /** Combined realized portfolio value across accounts. */
  total: number;
  /** Combined margin locked in open positions. */
  locked: number;
  /** Combined spendable quote balance. */
  spendable: number;
}

/** Builds one combined balance timeline by forward-filling account snapshots. */
function buildBaseTimeline(
  balanceSnapshots: Record<string, BacktestBalanceSnapshot[]>,
): TimelinePoint[] {
  const series = Object.values(balanceSnapshots)
    .map((snapshots) =>
      [...snapshots].sort((left, right) => left.t - right.t),
    )
    .filter((snapshots) => snapshots.length > 0);
  if (series.length === 0) return [];

  const times = [...new Set(series.flatMap((s) => s.map((p) => p.t)))].sort(
    (a, b) => a - b,
  );
  const cursors = series.map(() => 0);

  return times.map((t) => {
    let total = 0;
    let locked = 0;
    let spendable = 0;
    for (let i = 0; i < series.length; i++) {
      const snapshots = series[i];
      while (cursors[i] + 1 < snapshots.length && snapshots[cursors[i] + 1].t <= t) {
        cursors[i]++;
      }
      const snapshot = snapshots[cursors[i]];
      if (snapshot.t > t) continue;
      total += snapshot.total ?? 0;
      locked += snapshot.locked ?? 0;
      spendable += snapshot.spendable ?? 0;
    }
    return { t, total, locked, spendable };
  });
}

/**
 * Reconstructs one open position's unrealized PnL and deployed notional at t.
 * Notional is rebuilt per timestamp from the final margin minus later
 * averaging fills, so averaging steps do not inflate earlier observations.
 * Only used inside detected bear windows — the drawdown columns read the
 * cheaper per-position `pnl.maxDown*` extrema instead.
 */
function positionStateAt(
  position: Position,
  t: number,
): { floatingPnl: number; openBase: number } {
  const openedT = position.opened.t;
  const closedT = position.closed?.t ?? Number.POSITIVE_INFINITY;
  if (!(openedT <= t && t < closedT)) {
    return { floatingPnl: 0, openBase: 0 };
  }

  const executions = position.strategy.averaging.executions ?? [];
  const laterMargin = executions.reduce(
    (sum, execution) => sum + (execution.t > t ? execution.marginUsdt : 0),
    0,
  );
  const marginAt = (position.exposure.marginUsdt ?? 0) - laterMargin;
  const openBase = Math.max(0, marginAt) * (position.exposure.leverage ?? 1);

  let pct = 0;
  for (const point of position.pnl.history ?? []) {
    if (point.t > t) break;
    pct = point.pct;
  }

  return { floatingPnl: (openBase * pct) / 100, openBase };
}

function rangeOf(values: number[]): LeaderboardRange {
  if (values.length === 0) return { avg: 0, max: 0, min: 0 };
  const sum = values.reduce((a, b) => a + b, 0);
  return {
    avg: sum / values.length,
    max: Math.max(...values),
    min: Math.min(...values),
  };
}

/**
 * Per-position worst USDT dip relative to the mean combined total.
 * Sourced from the running `pnl.maxDownUsdt` extrema — no history scan.
 */
function portfolioDrawdown(
  positions: Position[],
  timeline: TimelinePoint[],
): LeaderboardRange {
  const totals = timeline
    .filter((point) => point.total > 0)
    .map((point) => point.total);
  if (totals.length === 0) return { avg: 0, max: 0, min: 0 };
  const meanTotal = totals.reduce((a, b) => a + b, 0) / totals.length;
  const values = positions
    .map((position) => position.pnl.maxDownUsdt)
    .filter((value): value is number => Number.isFinite(value))
    .map((usdt) => -usdt / meanTotal);
  return rangeOf(values);
}

/**
 * Per-position deepest dip vs its deployed notional: -`pnl.maxDownPct` / 100.
 * The extrema is an exact running minimum kept every monitoring pass, so it
 * beats the bounded, bucketed `pnl.history` series on accuracy and cost.
 */
function floatingDrawdown(positions: Position[]): LeaderboardRange {
  const values = positions
    .map((position) => position.pnl.maxDownPct)
    .filter((value): value is number => Number.isFinite(value))
    .map((pct) => -pct / 100);
  return rangeOf(values);
}

/** Durations the combined spendable balance stayed below the trading minimum. */
function emptyBalanceDurations(timeline: TimelinePoint[]): LeaderboardRange {
  const durations: number[] = [];
  let emptyStart: number | null = null;

  for (const [index, point] of timeline.entries()) {
    const empty = point.spendable <= MINIMAL_SPENDABLE_USDT;
    if (empty && emptyStart === null) emptyStart = point.t;
    if (!empty && emptyStart !== null) {
      durations.push(point.t - emptyStart);
      emptyStart = null;
    }
    if (index === timeline.length - 1 && emptyStart !== null) {
      durations.push(point.t - emptyStart);
    }
  }
  return rangeOf(durations);
}

/** exp(-CV) evenness score of closed trade counts across symbols. */
function tradeBalanceScore(positions: Position[]): number {
  const counts = new Map<string, number>();
  for (const position of positions) {
    if (!position.closed) continue;
    counts.set(position.symbol, (counts.get(position.symbol) ?? 0) + 1);
  }
  const values = [...counts.values()];
  if (values.length === 0) return 1;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return 1;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    values.length;
  return Math.max(0, Math.min(1, Math.exp(-Math.sqrt(variance) / mean)));
}

/** UTC month key (YYYY-MM) for a timestamp. */
function monthKey(t: number): string {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthStartMs(key: string): number {
  const [year, month] = key.split("-").map(Number);
  return Date.UTC(year, month - 1, 1);
}

function nextMonthStartMs(key: string): number {
  const [year, month] = key.split("-").map(Number);
  return month === 12 ? Date.UTC(year + 1, 0, 1) : Date.UTC(year, month, 1);
}

/** Month-end combined totals, keyed by UTC month. */
function monthlyEndTotals(timeline: TimelinePoint[]): Map<string, number> {
  const ends = new Map<string, number>();
  for (const point of timeline) {
    ends.set(monthKey(point.t), point.total);
  }
  return ends;
}

/** Combined total at the first snapshot inside a month, else the last before. */
function monthStartTotal(
  timeline: TimelinePoint[],
  key: string,
): number | undefined {
  const start = monthStartMs(key);
  const next = nextMonthStartMs(key);
  let lastBefore: number | undefined;
  for (const point of timeline) {
    if (point.t >= start && point.t < next) return point.total;
    if (point.t < next) lastBefore = point.total;
    else break;
  }
  return lastBefore;
}

/** Monthly-return Sharpe ratio: mean of month returns over their stddev. */
function sharpeRatio(timeline: TimelinePoint[]): number {
  const ends = monthlyEndTotals(timeline);
  const months = [...ends.keys()].sort();
  const returns: number[] = [];
  for (let i = 1; i < months.length; i++) {
    const prev = ends.get(months[i - 1]) ?? 0;
    const curr = ends.get(months[i]) ?? 0;
    if (prev > 0) returns.push(((curr - prev) / prev) * 100);
  }
  if (returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const stdDev = Math.sqrt(
    returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
      returns.length,
  );
  return stdDev === 0 ? 0 : Number((mean / stdDev).toFixed(4));
}

/** Realized monthly profit (closed net USDT) relative to month-start total. */
function monthlyGain(
  positions: Position[],
  timeline: TimelinePoint[],
): { gains: LeaderboardRange; avgMonthlyProfitUsdt: number } {
  const profits = new Map<string, number>();
  for (const position of positions) {
    if (!position.closed) continue;
    const key = monthKey(position.closed.t);
    profits.set(key, (profits.get(key) ?? 0) + (position.pnl.netUsdt ?? 0));
  }
  const months = new Set<string>(profits.keys());
  for (const point of timeline) months.add(monthKey(point.t));

  const percents: number[] = [];
  const profitValues: number[] = [];
  for (const key of [...months].sort()) {
    const starting = monthStartTotal(timeline, key);
    if (!starting || starting <= 0) continue;
    const profit = profits.get(key) ?? 0;
    profitValues.push(profit);
    percents.push((profit / starting) * 100);
  }

  const avgMonthlyProfitUsdt =
    profitValues.length === 0
      ? 0
      : profitValues.reduce((a, b) => a + b, 0) / profitValues.length;
  return { avgMonthlyProfitUsdt, gains: rangeOf(percents) };
}

/** Time-weighted held ratio + turnover capital efficiency scores. */
function capitalEfficiency(timeline: TimelinePoint[]): {
  hrScore: number;
  score: number;
  trScore: number;
} {
  if (timeline.length === 0) return { hrScore: 1, score: 0.5, trScore: 0 };
  const first = timeline[0].t;
  const last = timeline.at(-1)!.t;
  const totalTime = Math.max(1, last - first);

  let accumRatioTime = 0;
  let accumAbsDeltaLocked = 0;
  let totalSum = 0;
  for (const [index, point] of timeline.entries()) {
    const total = Math.max(EPS, point.total);
    totalSum += total;
    const ratio = Math.min(1, Math.max(0, point.locked) / total);
    const next = timeline[index + 1];
    const dt = next ? Math.max(1, next.t - point.t) : 0;
    if (dt > 0) accumRatioTime += ratio * dt;
    if (next) {
      accumAbsDeltaLocked += Math.abs(
        Math.max(0, next.locked) - Math.max(0, point.locked),
      );
    }
  }

  const avgTotal = Math.max(EPS, totalSum / timeline.length);
  const hrTimeWeighted = accumRatioTime / totalTime;
  const turnoverPerDay = ((accumAbsDeltaLocked / totalTime) * MS_PER_DAY) / avgTotal;

  const clamp01 = (v: number) =>
    Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
  const hrScore = clamp01(1 - hrTimeWeighted);
  const trScore = clamp01(turnoverPerDay);
  return { hrScore, score: clamp01((hrScore + trScore) / 2), trScore };
}

interface BearRange {
  end: number;
  start: number;
}

/** Detects peak-to-trough drawdown windows on a sparse price series. */
function detectBearRanges(points: Array<{ t: number; p: number }>): BearRange[] {
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const ranges: BearRange[] = [];
  let peakIndex = 0;

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].p > sorted[peakIndex].p) {
      peakIndex = i;
      continue;
    }
    const drawdown =
      (sorted[peakIndex].p - sorted[i].p) / sorted[peakIndex].p;
    if (drawdown < BEAR_DRAWDOWN_THRESHOLD) continue;

    let troughIndex = i;
    for (let j = i + 1; j < sorted.length; j++) {
      if (sorted[j].p < sorted[troughIndex].p) troughIndex = j;
      else if (sorted[j].p > sorted[peakIndex].p) break;
    }

    ranges.push({ end: sorted[troughIndex].t, start: sorted[peakIndex].t });
    i = troughIndex;
    peakIndex = i + 1;
  }
  return ranges;
}

/**
 * Mean floating resilience inside detected bear windows, in percent.
 * Floating PnL is reconstructed only for timeline points inside a window.
 */
function bearMarketProofRatio(
  timeline: TimelinePoint[],
  positions: Position[],
  vPointsMap?: Record<string, VolatilityPoint[]>,
): number {
  const ranges = Object.values(vPointsMap ?? {}).flatMap((points) =>
    detectBearRanges(points.map((point) => ({ p: point.p, t: point.t }))),
  );
  if (timeline.length === 0 || ranges.length === 0) return 0;

  let totalDrawdown = 0;
  let counted = 0;
  for (const range of ranges) {
    const records = timeline.filter(
      (point) => point.t >= range.start && point.t <= range.end,
    );
    if (records.length === 0) continue;
    const windowPositions = positions.filter(
      (position) =>
        position.opened.t <= range.end &&
        (position.closed?.t ?? Number.POSITIVE_INFINITY) > range.start,
    );
    const avgTotal =
      records.reduce((sum, point) => sum + point.total, 0) / records.length;
    const avgFloating =
      records.reduce(
        (sum, point) =>
          sum +
          point.total +
          windowPositions.reduce(
            (inner, position) =>
              inner + positionStateAt(position, point.t).floatingPnl,
            0,
          ),
        0,
      ) / records.length;
    if (avgTotal <= 0) continue;
    totalDrawdown += (avgTotal - avgFloating) / avgTotal;
    counted++;
  }
  return counted > 0 ? (1 - totalDrawdown / counted) * 100 : 0;
}

/**
 * Computes the full leaderboard metric set for one precision backtest result.
 * Drawdown columns read the per-position `pnl.maxDown*` extrema; floating
 * reconstruction runs only for bear-window resilience.
 */
export function computeLeaderboardMetrics(input: {
  balanceSnapshots: Record<string, BacktestBalanceSnapshot[]>;
  positions: Position[];
  vPointsMap?: Record<string, VolatilityPoint[]>;
}): BacktestLeaderboardMetrics {
  const { positions, balanceSnapshots, vPointsMap } = input;
  const timeline = buildBaseTimeline(balanceSnapshots);

  const closed = positions.filter((position) => position.closed);
  const wins = closed.filter(
    (position) => (position.pnl.netUsdt ?? 0) > 0,
  ).length;

  const startingBalance = Object.values(balanceSnapshots).reduce(
    (sum, snapshots) => sum + (snapshots[0]?.startingBalance ?? snapshots[0]?.total ?? 0),
    0,
  );
  const finalTotal = timeline.at(-1)?.total ?? startingBalance;
  const gainPct =
    startingBalance > 0
      ? ((finalTotal - startingBalance) / startingBalance) * 100
      : 0;

  const monthly = monthlyGain(positions, timeline);

  return {
    avgMonthlyProfitPct:
      startingBalance > 0
        ? (monthly.avgMonthlyProfitUsdt / startingBalance) * 100
        : 0,
    balanceTradesScore: tradeBalanceScore(positions),
    bearMarketProofRatio: bearMarketProofRatio(timeline, positions, vPointsMap),
    capitalEfficiency: capitalEfficiency(timeline),
    emptyBalance: emptyBalanceDurations(timeline),
    gainPct,
    maxFloatingDrawdown: floatingDrawdown(positions),
    maxPortfolioDrawdown: portfolioDrawdown(positions, timeline),
    monthlyGain: monthly.gains,
    positionsClosed: closed.length,
    sharpeRatio: sharpeRatio(timeline),
    winRate: closed.length > 0 ? (wins / closed.length) * 100 : 0,
  };
}
