const FILTER_STORAGE_KEY = "precision-backtest-trade-history-filters";

/** Minimal trade shape the filter condition readers rely on. */
interface FilterableTrade {
  account: string;
  closed?: { t?: number; vPoint?: { lvl?: number } };
  exposure?: { marginUsdt?: number };
  opened: { t: number; vPoint?: { lvl?: number } };
  pnl?: { netPct?: number; netUsdt?: number };
}

export type BacktestTradeMetric =
  | "entryLevel"
  | "exitLevel"
  | "holdDays"
  | "marginUsdt"
  | "pnlPct"
  | "pnlUsdt";

export type BacktestTradeOperator = "lt" | "lte" | "eq" | "gte" | "gt";

/** Numeric trade metrics a filter condition can evaluate. */
export const TRADE_METRICS: Record<
  BacktestTradeMetric,
  { label: string; read: (trade: FilterableTrade) => number | undefined }
> = {
  entryLevel: {
    label: "Entry level",
    read: (trade) => {
      const lvl = trade.opened.vPoint?.lvl;
      return typeof lvl === "number" && Number.isFinite(lvl)
        ? Math.abs(lvl)
        : undefined;
    },
  },
  exitLevel: {
    label: "Exit level",
    read: (trade) => {
      const lvl = trade.closed?.vPoint?.lvl;
      return typeof lvl === "number" && Number.isFinite(lvl)
        ? Math.abs(lvl)
        : undefined;
    },
  },
  holdDays: {
    label: "Hold days",
    read: (trade) => {
      const closedT = trade.closed?.t;
      return typeof closedT === "number" && Number.isFinite(closedT)
        ? (closedT - trade.opened.t) / 86_400_000
        : undefined;
    },
  },
  marginUsdt: {
    label: "Margin USDT",
    read: (trade) => {
      const margin = trade.exposure?.marginUsdt;
      return typeof margin === "number" && Number.isFinite(margin)
        ? margin
        : undefined;
    },
  },
  pnlPct: {
    label: "PnL %",
    read: (trade) => {
      const pct = trade.pnl?.netPct;
      return typeof pct === "number" && Number.isFinite(pct)
        ? pct
        : undefined;
    },
  },
  pnlUsdt: {
    label: "PnL USD",
    read: (trade) => {
      const pnl = trade.pnl?.netUsdt;
      return typeof pnl === "number" && Number.isFinite(pnl)
        ? pnl
        : undefined;
    },
  },
};

/** Comparison operators for the filter condition. */
export const TRADE_OPERATORS: Record<
  BacktestTradeOperator,
  { label: string; test: (a: number, b: number) => boolean }
> = {
  lt: { label: "<", test: (a, b) => a < b },
  lte: { label: "≤", test: (a, b) => a <= b },
  eq: { label: "=", test: (a, b) => a === b },
  gte: { label: "≥", test: (a, b) => a >= b },
  gt: { label: ">", test: (a, b) => a > b },
};

interface StoredTradeFilters {
  account?: string;
  /** Legacy `exitLevel >` bound — migrated into metric/operator on read. */
  exitLevel?: string;
  from?: string;
  metric?: string;
  operator?: string;
  to?: string;
  value?: string;
}

/** Reads the last used filter values; `{}` when storage is unavailable. */
export function readStoredFilters(): StoredTradeFilters {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(FILTER_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : undefined;
    const stored =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as StoredTradeFilters)
        : {};
    // Migrate the legacy single-purpose `exitLevel >` bound.
    if (stored.exitLevel !== undefined && stored.metric === undefined) {
      return {
        ...stored,
        metric: "exitLevel",
        operator: "gt",
        value: stored.exitLevel,
      };
    }
    return stored;
  } catch {
    // Local storage can be unavailable in private or restricted contexts.
    return {};
  }
}

/** Persists the current filter values; removes the key once all are empty. */
export function writeStoredFilters(filters: StoredTradeFilters): void {
  if (typeof window === "undefined") return;
  try {
    if (filters.account || filters.from || filters.to || filters.value) {
      window.localStorage.setItem(
        FILTER_STORAGE_KEY,
        JSON.stringify(filters),
      );
    } else {
      window.localStorage.removeItem(FILTER_STORAGE_KEY);
    }
  } catch {
    // Local storage can be unavailable in private or restricted contexts.
  }
}

export interface BacktestTradeFilters {
  /** Account slug; undefined matches every account. */
  account?: string;
  /** Inclusive entry-time lower bound; undefined matches from the start. */
  fromMs?: number;
  /** Trade metric evaluated by `TRADE_METRICS`. */
  metric?: BacktestTradeMetric;
  /** Comparison applied between the metric value and `value`. */
  operator?: BacktestTradeOperator;
  /** Inclusive entry-time upper bound; undefined matches to the end. */
  toMs?: number;
  /** Right-hand side of the metric comparison. */
  value?: number;
}

/**
 * Filters backtest trades by account slug, entry-time bounds, and one
 * composable metric condition (`metric operator value`, e.g.
 * `entryLevel < 1` keeps level-0 entries). All set filters apply with AND
 * semantics; unset filters match everything. A trade whose metric reads
 * `undefined` never satisfies an active condition.
 */
export function filterBacktestTradeHistory<T extends FilterableTrade>(
  history: T[],
  filters: BacktestTradeFilters,
): T[] {
  const { account, fromMs, metric, operator, toMs, value } = filters;
  const read = metric ? TRADE_METRICS[metric]?.read : undefined;
  const test = operator ? TRADE_OPERATORS[operator]?.test : undefined;
  const hasCondition =
    read !== undefined &&
    test !== undefined &&
    typeof value === "number" &&
    Number.isFinite(value);
  if (!account && !hasCondition && fromMs === undefined && toMs === undefined) {
    return history;
  }
  return history.filter((trade) => {
    if (account && trade.account !== account) return false;
    if (fromMs !== undefined && trade.opened.t < fromMs) return false;
    if (toMs !== undefined && trade.opened.t > toMs) return false;
    if (hasCondition) {
      const metricValue = read(trade);
      if (metricValue === undefined || !test(metricValue, value)) {
        return false;
      }
    }
    return true;
  });
}
