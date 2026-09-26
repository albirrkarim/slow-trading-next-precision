import type { BacktestBalanceSnapshot } from "@/lib/dev/backtestPrecision/backtest/backtest-precision-types";
import type { PrecisionTestCaseMode } from "@/lib/production/precision-test-case";
import type { BalanceSummary, Position } from "@/lib/system/trading";
import type { ExchangeType, VolatilityPoint } from "@/lib/system/types";

/** Summary of a completed production capture selectable in the checker UI. */
export interface PrecisionCheckerTestCaseSummary {
  fileName: string;
  mode: PrecisionTestCaseMode;
  startTime: number;
  endTime: number;
  tradeCount: number;
}

/** Display-facing account info carried over from the captured config. */
export interface PrecisionCheckerAccount {
  slug: string;
  name: string;
  trading?: { notes: string };
}

/** Side-by-side closed-trade histories for one replayed test case. */
export interface PrecisionCheckerRunResult {
  testCase: PrecisionCheckerTestCaseSummary;
  accounts: PrecisionCheckerAccount[];
  exchangeType: ExchangeType;
  productionHistory: Position[];
  backtestHistory: Position[];
  productionVPointsMap: Record<string, VolatilityPoint[]>;
  backtestVPointsMap: Record<string, VolatilityPoint[]>;
  /** Replay input balance per account — the starting point both sides share. */
  initialBalance: Record<string, BalanceSummary>;
  /** Production balance captured when the recording ended. */
  productionEndBalance: Record<string, BalanceSummary>;
  /** Raw backtest balance timelines per account — last snapshot is run end. */
  backtestBalanceSnapshots: Record<string, BacktestBalanceSnapshot[]>;
}
