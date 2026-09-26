import type { Position } from "@/lib/system/trading";

/** Result of pairing production vs backtest trade-history positions. */
export interface TradePairing {
  prodTotal: number;
  btTotal: number;
  pairCount: number;
  /** Production leftovers + backtest leftovers. */
  unpaired: number;
  /** Mean |opened.t diff| in minutes across pairs — null when no pairs. */
  meanEntryMinuteDiff: number | null;
  /** Mean |closed.t diff| in minutes across pairs — null when no pairs. */
  meanExitMinuteDiff: number | null;
  /** Mean |averaging executions diff| across pairs — null when no pairs. */
  meanAveragingCountDiff: number | null;
  /**
   * Mean |execution t diff| in minutes across pairs — executions pair by
   * order index, leftovers ignored; divided by trade-pair count.
   */
  meanAveragingMinuteDiff: number | null;
  /** Total averaging-execution pairs zipped across all trade pairs. */
  averagingPairCount: number;
  /** Mean |pnl.netUsdt diff| in USDT across pairs — null when no pairs. */
  meanPnlUsdtDiff: number | null;
  /** Mean |pnl.netPct diff| in pct points across pairs — null when no pairs. */
  meanPnlPctDiff: number | null;
  /** Pairs whose `closed.reason` differs. */
  exitReasonMismatches: number;
}

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

function pairKey(position: Position): string {
  // account slug + symbol + entry hour bucket (dd-mm-yyyy-HH).
  return `${position.account}|${position.symbol}|${Math.floor(position.opened.t / HOUR_MS)}`;
}

function averagingCount(position: Position): number {
  return position.strategy.averaging.executions?.length ?? 0;
}

/**
 * Greedy one-to-one pairing of production and backtest closed positions.
 *
 * Two positions pair when they share account, symbol, and the same entry
 * hour bucket; within a bucket the nearest unconsumed backtest position
 * (by entry time) wins. Minute diffs are absolute.
 */
function pairTrades(
  productionHistory: Position[],
  backtestHistory: Position[],
): TradePairing {
  const prod = [...productionHistory].sort((a, b) => a.opened.t - b.opened.t);

  const buckets = new Map<string, Position[]>();
  for (const position of backtestHistory) {
    const key = pairKey(position);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(position);
    } else {
      buckets.set(key, [position]);
    }
  }

  let pairCount = 0;
  let sumEntryMinuteDiff = 0;
  let sumExitMinuteDiff = 0;
  let sumAveragingCountDiff = 0;
  let sumAveragingMinuteDiff = 0;
  let averagingPairCount = 0;
  let sumPnlUsdtDiff = 0;
  let sumPnlPctDiff = 0;
  let exitReasonMismatches = 0;

  for (const prodPosition of prod) {
    const bucket = buckets.get(pairKey(prodPosition));
    if (!bucket || bucket.length === 0) continue;

    let bestIdx = 0;
    let bestDiff = Math.abs(prodPosition.opened.t - bucket[0].opened.t);
    for (let i = 1; i < bucket.length; i++) {
      const diff = Math.abs(prodPosition.opened.t - bucket[i].opened.t);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIdx = i;
      }
    }
    const btPosition = bucket.splice(bestIdx, 1)[0];

    pairCount++;
    sumEntryMinuteDiff +=
      Math.abs(prodPosition.opened.t - btPosition.opened.t) / MINUTE_MS;

    if (prodPosition.closed && btPosition.closed) {
      sumExitMinuteDiff +=
        Math.abs(prodPosition.closed.t - btPosition.closed.t) / MINUTE_MS;
      if (prodPosition.closed.reason !== btPosition.closed.reason) {
        exitReasonMismatches++;
      }
    }

    sumAveragingCountDiff += Math.abs(
      averagingCount(prodPosition) - averagingCount(btPosition),
    );

    sumPnlUsdtDiff += Math.abs(
      (prodPosition.pnl.netUsdt ?? 0) - (btPosition.pnl.netUsdt ?? 0),
    );
    sumPnlPctDiff += Math.abs(
      (prodPosition.pnl.netPct ?? 0) - (btPosition.pnl.netPct ?? 0),
    );

    const prodExecs = prodPosition.strategy.averaging.executions ?? [];
    const btExecs = btPosition.strategy.averaging.executions ?? [];
    const execPairs = Math.min(prodExecs.length, btExecs.length);
    averagingPairCount += execPairs;
    for (let i = 0; i < execPairs; i++) {
      sumAveragingMinuteDiff +=
        Math.abs(prodExecs[i].t - btExecs[i].t) / MINUTE_MS;
    }
  }

  return {
    prodTotal: productionHistory.length,
    btTotal: backtestHistory.length,
    pairCount,
    unpaired:
      productionHistory.length - pairCount +
      (backtestHistory.length - pairCount),
    meanEntryMinuteDiff: pairCount > 0 ? sumEntryMinuteDiff / pairCount : null,
    meanExitMinuteDiff: pairCount > 0 ? sumExitMinuteDiff / pairCount : null,
    meanAveragingCountDiff:
      pairCount > 0 ? sumAveragingCountDiff / pairCount : null,
    meanAveragingMinuteDiff:
      pairCount > 0 ? sumAveragingMinuteDiff / pairCount : null,
    averagingPairCount,
    meanPnlUsdtDiff: pairCount > 0 ? sumPnlUsdtDiff / pairCount : null,
    meanPnlPctDiff: pairCount > 0 ? sumPnlPctDiff / pairCount : null,
    exitReasonMismatches,
  };
}

export default pairTrades;
