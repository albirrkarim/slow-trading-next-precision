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
 * The emitted detection datum of a volatility point — written once by the
 * detector when a pivot confirms and immutable afterwards. Persisted as the
 * point's ground truth.
 */
export interface VolatilityPointBasic {
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
}

/**
 * Live bookkeeping attached to a point while the engine runs — refreshed on
 * every mark-price pass or set when the point travels outside its symbol
 * map. Absent on points that were never hydrated at runtime.
 */
export interface VolatilityPointRuntime {
  /**
   * Runtime owner symbol when a point is carried outside its symbol map.
   */
  symbol?: string;

  /**
   * Largest upward excursion of the tracked price above `p` since the point
   * formed, in percent points, refreshed on every mark-price update.
   * `maxUpPct >= VOLATILITY_THRESHOLD` means the detector's UP sequence is
   * active again — a new TOP is forming but not yet emitted.
   */
  maxUpPct?: number;

  /**
   * Largest downward excursion of the tracked price below `p` since the
   * point formed, in percent points, refreshed on every mark-price update.
   * `maxDownPct >= VOLATILITY_THRESHOLD` means the detector's DOWN sequence
   * is active — a new BOTTOM is forming but not yet emitted.
   */
  maxDownPct?: number;

  /**
   * just for debugging
   */
  message?: string;
}

/**
 * Strategy-facing inputs and consumption bookkeeping — the active strategy
 * reads these when sizing and labeling entries and writes consumption
 * markers after an action succeeds. The engine only stores and matches
 * the raw values.
 */
export interface VolatilityPointDecision {
  /**
   * Usage markers written by the active strategy after an action succeeds.
   * Marker format is strategy-chosen; the runtime only stores and matches
   * the raw strings. Convention: `"<accountSlug>"` consumes the point for
   * the whole account, `"<accountSlug>:<ROLE>"` scopes consumption to one
   * pair leg. Absent or empty means unused.
   */
  usedBy?: string[];
}

/**
 * Volatility Point is point that mark the wave of the price volatility
 *
 * Current point is determined based on the volatility point before wether its TOP or DOWN about 5% or more.
 */
export interface VolatilityPoint
  extends VolatilityPointBasic,
    VolatilityPointRuntime,
    VolatilityPointDecision {}
