import type { BalanceSummary } from "@/components/LiveDashboard/Navbar/Settings/settings-types";
import type { AveragingRecommendation, EntryRecommendation } from "../brain";
import type { FetchKlinesFunction } from "../datasets/type";
import type { VolatilityPoint } from "../dynamic";
import type { SlowTradingSettingsConfig } from "../slowTrading";
import type {
  Position,
  PositionDirection,
  TradeDecision,
} from "../trading/models";
import type { RuntimeHelper } from "./helper/types";

// Pack of market function
interface MarketFunction {
  getKlines: FetchKlinesFunction;
}

interface ExchangeFunction {
  /**
   * Not needed in backtest
   */
  getBalance?: (
    accountSlug?: string,
  ) => number | Promise<number>;
}

/**
 * Environment clock used by the shared runtime scheduler.
 *
 * Backtests advance logical time immediately, while production waits for the
 * requested wall-clock boundary.
 */
export interface RuntimeClock {
  /** Advances or waits until the requested Unix timestamp in milliseconds. */
  advanceTo(time: number): Promise<void> | void;
  /** Reports whether the runtime should stop scheduling additional stages. */
  finished(): Promise<boolean> | boolean;
  /** Returns the clock's current canonical Unix timestamp in milliseconds. */
  now(): number;
}

export interface RuntimeEngineState {
  /**
   * Global time for the backtest
   */
  currentTime: number;

  /**
   * Production: live/sandbox
   * Backtest: precision backtest
   */
  mode: "live" | "sandbox" | "backtest";

  openPositions: Position[];

  /**
   * All config
   */
  config: SlowTradingSettingsConfig;

  /**
   * Balance info per account slug
   */
  balance: Record<string, BalanceSummary>;

  /**
   * {
   *    "SUI": []
   *    "BTC": []
   * }
   */
  vPointsMap: Record<string, VolatilityPoint[]>;

  /**
   * {
   *    "SUI":{
   *     lastUpdated:0,
   *      price:0
   *    }
   * }
   */
  markPriceMap: Record<
    string,
    {
      // unix
      lastUpdated: number;
      // coing price
      price: number;
    }
  >;
}

/**
 * Approved entry candidate produced by the shared decision pipeline.
 */
export interface RuntimeEntryDecision {
  type: "entry";
  accountSlug: string;
  direction: PositionDirection;
  entrySignal: EntryRecommendation;
  message: string;
  symbol: string;
}

/**
 * Averaging candidate for an existing open position.
 */
export interface RuntimeAveragingDecision {
  type: "averaging";
  accountSlug: string;
  message: string;
  position: Position;
  recommendation: AveragingRecommendation;
  symbol: string;
}

/**
 * Exit candidate for an existing open position.
 */
export interface RuntimeExitDecision {
  type: "exit";
  accountSlug: string;
  message: string;
  position: Position;
  symbol: string;
  tradeDecision: TradeDecision;
}

export type RuntimeDecision =
  | RuntimeEntryDecision
  | RuntimeAveragingDecision
  | RuntimeExitDecision;

/**
 * We will have Backend adapter and production adapter
 */
export interface RuntimeEngineAdapter {
  /** Environment clock: instant in backtest, real-time in production. */
  clock: RuntimeClock;

  /**
   * Getting the market data
   */
  market: MarketFunction;

  /**
   * we pass the exchange lib so it can later be tested outside
   * does it really called the update balance after doing some action
   */
  exchange: ExchangeFunction;

  /**
   * with the strategy outside we can doing manythings
   * adapt to our 3 instance (multi, hedge, both)
   *
   * so the sequence will be like
   *
   * common entry signal by default runtime engine and current config
   * then approved by this onStrategy function.
   *
   * Its the final gate wether can actually entry, averaging, exit
   */
  onStrategy: (
    decision: RuntimeDecision,
    context: RuntimeContext,
  ) => Promise<boolean>;

  /**
   * Telling outside runtime engine initiate. some action
   * For entry, averaging, exit
   */
  onAction: (
    decision: RuntimeDecision,
    context: RuntimeContext,
  ) => Promise<Position | null>;

  /** Persists a closed position after the shared runtime updates its state. */
  onExit: (position: Position, context: RuntimeContext) => Promise<void>;

  /**
   * Persists the environment's account state after a successful action.
   *
   * The runtime invokes this hook only after `onAction` has returned a
   * position and the shared monitoring code has applied its own mutation:
   *
   * 1. `onAction` executes or simulates the order.
   * 2. The runtime updates `state.openPositions` and `state.balance`.
   * 3. This hook persists that now-consistent state.
   *
   * Entry and averaging actions use this hook. Exit persistence is handled by
   * `onExit`, which is called after the closed position has been removed from
   * `state.openPositions` and its margin has been released. Backtest adapters
   * can omit this hook because their result is already retained in memory.
   *
   * @param context - The shared runtime context containing the updated state,
   * adapter, and helper operations.
   */
  onStateChange?: (context: RuntimeContext) => Promise<void>;

  /**
   * To send notification outside
   * Unused in backtest
   */
  onNotif: () => boolean;
}

/** Shared dependencies and mutable state supplied to every runtime operation. */
export interface RuntimeContext {
  /** Environment-specific clock, market, exchange, execution, and output hooks. */
  adapter: RuntimeEngineAdapter;
  /** State-bound account, balance, configuration, and market helpers. */
  helper: RuntimeHelper;
  /** Canonical mutable runtime state shared by backtest and production flows. */
  state: RuntimeEngineState;
}
