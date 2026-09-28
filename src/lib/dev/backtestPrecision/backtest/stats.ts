import type { Position } from "@/lib/system/trading";

import type {
  BacktestAccountSummary,
  BacktestBalanceSnapshot,
  BacktestExitBuckets,
  BacktestPrecisionResult,
  BacktestReasonCount,
  BacktestRunCounts,
  BacktestRunSummary,
} from "./backtest-precision-types";

type Histogram = Map<string, number>;

interface ExitBucketDraft {
  profit: Histogram;
  loss: Histogram;
  profitCoins: Histogram;
  lossCoins: Histogram;
}

const newExitBucketDraft = (): ExitBucketDraft => ({
  profit: new Map(),
  loss: new Map(),
  profitCoins: new Map(),
  lossCoins: new Map(),
});

const bump = (map: Histogram, key: string) =>
  map.set(key, (map.get(key) ?? 0) + 1);

/** Histogram to sorted slice list: count desc, then name asc. */
const toReasonCounts = (map: Histogram): BacktestReasonCount[] =>
  Array.from(map, ([reason, count]) => ({ count, reason })).sort(
    (left, right) =>
      right.count - left.count || left.reason.localeCompare(right.reason),
  );

const displaySymbol = (symbol: string) =>
  symbol.replace(/_USDT$/, "").toUpperCase();

/**
 * Accumulates the compact run aggregates while positions close, snapshots
 * land, and vPoints are detected. The recorded maps stay tiny (per-account
 * histograms), so a chunked run never needs the artifact arrays to produce
 * its summary block.
 */
function createTracker() {
  let closedPositions = 0;
  let openPositions = 0;
  let vPointCount = 0;
  let snapshotCount = 0;
  const firstSnapshot = new Map<string, BacktestBalanceSnapshot>();
  const lastSnapshot = new Map<string, BacktestBalanceSnapshot>();
  /** Last counted timestamp per slug — same-t recaptures replace, not append. */
  const lastSnapshotT = new Map<string, number>();
  const winsLosses = new Map<string, { wins: number; losses: number }>();
  const exits = new Map<string, ExitBucketDraft>();

  const tracker = {
    /** Counts one exited position and files its reason/symbol histograms. */
    onExit(position: Position) {
      if (!position.closed) return;
      closedPositions += 1;
      const slug = position.account;
      const profit = (position.pnl.netUsdt ?? 0) > 0;

      const wl = winsLosses.get(slug) ?? { wins: 0, losses: 0 };
      if (profit) wl.wins += 1;
      else wl.losses += 1;
      winsLosses.set(slug, wl);

      const bucket = exits.get(slug) ?? newExitBucketDraft();
      const reason = position.closed.reason || "UNKNOWN";
      const symbol = displaySymbol(position.symbol);
      bump(profit ? bucket.profit : bucket.loss, reason);
      bump(profit ? bucket.profitCoins : bucket.lossCoins, symbol);
      exits.set(slug, bucket);
    },

    /** Counts one position still open at run end. */
    onOpen() {
      openPositions += 1;
    },

    onVPoint() {
      vPointCount += 1;
    },

    /** Tracks first/last snapshot per account for realized pnl rows. */
    onSnapshot(slug: string, snapshot: BacktestBalanceSnapshot) {
      if (lastSnapshotT.get(slug) !== snapshot.t) snapshotCount += 1;
      if (!firstSnapshot.has(slug)) firstSnapshot.set(slug, snapshot);
      lastSnapshot.set(slug, snapshot);
      lastSnapshotT.set(slug, snapshot.t);
    },

    counts(): BacktestRunCounts {
      return {
        closedPositions,
        positions: closedPositions + openPositions,
        snapshots: snapshotCount,
        vPoints: vPointCount,
      };
    },

    summary(): BacktestRunSummary {
      const accounts: BacktestAccountSummary[] = Array.from(
        lastSnapshot.keys(),
      ).map((slug) => {
        const first = firstSnapshot.get(slug);
        const last = lastSnapshot.get(slug);
        const start =
          first && first.startingBalance > 0
            ? first.startingBalance
            : (first?.total ?? 0);
        const end = last?.total ?? start;
        const pnlUsdt = end - start;
        const wl = winsLosses.get(slug) ?? { wins: 0, losses: 0 };
        return {
          slug,
          start,
          end,
          pnlUsdt,
          gainPct: start > 0 ? (pnlUsdt / start) * 100 : null,
          wins: wl.wins,
          losses: wl.losses,
        } satisfies BacktestAccountSummary;
      });

      const exitsSummary: Record<string, BacktestExitBuckets> = {};
      for (const [slug, bucket] of exits) {
        exitsSummary[slug] = {
          profit: toReasonCounts(bucket.profit),
          loss: toReasonCounts(bucket.loss),
          profitCoins: toReasonCounts(bucket.profitCoins),
          lossCoins: toReasonCounts(bucket.lossCoins),
        };
      }

      return { accounts, exits: exitsSummary };
    },
  };

  return tracker;
}

/** Rebuilds counts + summary from a materialized result (legacy cache dirs). */
function summarize(result: BacktestPrecisionResult): {
  counts: BacktestRunCounts;
  summary: BacktestRunSummary;
} {
  const tracker = createTracker();
  for (const position of result.positions) {
    if (position.closed) tracker.onExit(position);
    else tracker.onOpen();
  }
  for (const [slug, snapshots] of Object.entries(result.balanceSnapshots)) {
    for (const snapshot of snapshots) tracker.onSnapshot(slug, snapshot);
  }
  for (const points of Object.values(result.vPointsMap)) {
    points.forEach(() => tracker.onVPoint());
  }
  return { counts: tracker.counts(), summary: tracker.summary() };
}

const backtestStats = {
  tracker: {
    create: createTracker,
  },
  summarize,
} as const;

export default backtestStats;
