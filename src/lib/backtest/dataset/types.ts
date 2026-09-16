import type { ExchangeType } from "@/lib/exchange";
import type { Kline } from "@/lib/exchange/platform/tokocrypto";

/** Candle intervals stored by a V1 backtest dataset. */
export type BacktestDatasetInterval = "1m" | "5m";

/** Per-interval kline series for one symbol. */
export type BacktestDatasetKlines = Record<
  BacktestDatasetInterval,
  Kline[]
>;

/** Reconstructed market history consumed by a V1 precision backtest. */
export interface BacktestDatasetV1 {
  schema: 1;
  /** Exchange the klines were downloaded from. */
  sourceExchangeType: ExchangeType;
  /** Market type the klines belong to. */
  marketType: "SPOT" | "FUTURES";
  /** Dataset kline coverage start, including the warmup window. */
  warmupStartTime: number;
  /** Precision run window start. */
  startTime: number;
  /** Precision run window end. */
  endTime: number;
  /** Normalized uppercase symbols, always including BTC. */
  symbols: string[];
  klines: Record<string, BacktestDatasetKlines>;
}

/** Metadata for one persisted dataset. */
export interface BacktestDatasetSummary {
  fileName: string;
  sourceExchangeType: ExchangeType;
  marketType: "SPOT" | "FUTURES";
  warmupStartTime: number;
  startTime: number;
  endTime: number;
  symbols: string[];
}
