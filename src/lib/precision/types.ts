import type { BalanceSummary } from "@/components/LiveDashboard/Navbar/Settings/settings-types";
import type { FetchKlinesFunction } from "../datasets/type";
import type { SlowTradingSettingsConfig } from "../slowTrading";
import type { Position } from "../trading/models";
import type { RuntimeHelper } from "./helper/types";
import { VolatilityPoint } from "../dynamic";

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

type ActionType = "entry" | "averaging" | "exit";

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
  onStrategy: (action: ActionType, context: RuntimeContext) => boolean;

  /**
   * Telling outside runtime engine initiate. some action
   * For entry, averaging, exit
   */
  onAction: (action: ActionType, context: RuntimeContext) => boolean;

  /**
   * To send notification outside
   * Unused in backtest
   */
  onNotif: () => boolean;
}

export interface RuntimeContext {
  adapter: RuntimeEngineAdapter;
  helper: RuntimeHelper;
  state: RuntimeEngineState;
}
