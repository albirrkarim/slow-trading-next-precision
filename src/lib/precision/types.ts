import type { BalanceSummary } from "@/components/LiveDashboard/Navbar/Settings/settings-types";
import type { FetchKlinesFunction } from "../datasets/type";
import type { SlowTradingSettingsConfig } from "../slowTrading";
import type { Position } from "../trading/models";
import type { RuntimeHelper } from "./helper/types";

// Pack of market function
interface MarketFunction {
  getKlines: FetchKlinesFunction;
}

interface ExchangeFunction {
  /**
   * Not needed in backtest
   */
  getBalance?: () => number;
}

export interface RuntimeClock {
  advanceTo(time: number): Promise<void> | void;
  finished(): Promise<boolean> | boolean;
  now(): number;
}

export interface RuntimeEngineState {
  /**
   * Global time for the backtest
   */
  currentTime: number;

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
}

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
   * adapt to our 3 instance.
   *
   * multi,
   */
  onStrategy: () => boolean;

  /**
   * For entry, averaging exit
   */
  onAction: () => boolean;

  /**
   * To send notification outside
   */
  onNotif: () => boolean;
}

export interface RuntimeContext {
  adapter: RuntimeEngineAdapter;
  helper: RuntimeHelper;
  state: RuntimeEngineState;
}
