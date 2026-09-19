import { FetchKlinesFunction } from "../datasets/type";

export interface RuntimeEngineInput {
  mode: "live" | "sandbox" | "backtest";
  clock: number;
  market: MarketFunction;
}

// Pack of market function
interface MarketFunction {
  getKlines: FetchKlinesFunction;
}
