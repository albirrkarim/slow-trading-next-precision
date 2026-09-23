/**
 * Strategy-neutral market primitives shared by every runtime environment.
 * These types intentionally carry no exchange, brain, or SLOW dependencies.
 */
export type ExchangeType = "okx" | "tokocrypto" | "binance";
export type TradingMode =
  | "spot"
  | "margin_cross"
  | "margin_isolated"
  | "futures";
export type MarketType = "SPOT" | "FUTURES";

/**
 * Candlestick bar in the exchange wire format:
 * `[openTime, open, high, low, close, volume, closeTime, quoteVolume,
 * trades, takerBaseVolume, takerQuoteVolume, ignore, humanTime]`.
 */
export type Kline = [
  number,
  string,
  string,
  string,
  string,
  string,
  number,
  string,
  number,
  string,
  string,
  string,
  string,
];

export interface FetchKlinesParams {
  symbol: string;
  interval?: string;
  marketType?: MarketType;
  startTime?: number;
  endTime?: number;
  minutes?: number;
  simpleTime?: string;
  exactDate?: boolean;
  signal?: AbortSignal;
  [key: string]: unknown;
}

export type FetchKlines = (
  params: FetchKlinesParams,
) => Promise<Kline[]>;

/**
 * Volatility Point is point that mark the wave of the price volatility
 *
 * Current point is determined based on the volatility point before wether its TOP or DOWN about 5% or more.
 */
export interface VolatilityPoint<TFeature = unknown> {
  /**
   * Id for volatility point.
   *
   * Example: B_cbf_12_04_26_04_20
   * Format: [label]_[hash]_[date]
   */
  id: string;

  /**
   * Defined in milliseconds.
   */
  t: number;

  /**
   * T = TOP
   * B = BOTTOM
   */
  l: "T" | "B";

  /**
   * Percent change relative to last pivot.
   *
   * Unit: percent points, e.g. 6.74 means 6.74%.
   * Stored as 0-100 scale, not 0-1 ratio.
   */
  pct: number;

  /**
   * Current price.
   */
  p: number;

  /** Base volume. */
  vb: number;

  /** Quote volume. */
  vq: number;

  /**
   * Volatility level based on previous points.
   */
  lvl: number;

  /**
   * Runtime owner symbol when a point is carried outside its symbol map.
   *
   * [EXCLUDE FROM DATASET]
   */
  symbol?: string;

  /**
   * Legacy point-wide backtest usage marker. Account-aware entry and averaging
   * use runtime `usedBy<accountSlug>` properties instead.
   *
   * [EXCLUDE FROM DATASET]
   */
  used?: boolean;

  /**
   * Delta in ms between v point before and the current v point
   */
  delta?: number;

  /**
   * just for debugging
   */
  message?: string;

  /**
   * old: What feature so the system is decide to buy using this point
   *
   * new: act as temp feature. for entry
   */
  feature?: TFeature;

  /**
   * How sure the system to buy using this point
   */
  probability?: number;

  /**
   * Maximal USDT
   */
  maxUsdtEntry?: number;

  /**
   * Why the system decide to buy using this point
   */
  descisionLabel?: string;
}
