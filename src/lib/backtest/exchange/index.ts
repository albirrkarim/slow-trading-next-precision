import { BinanceExchange } from "@/lib/exchange/adapters/binance";
import type {
  UnifiedBalance,
  UnifiedWithdrawAssetParams,
  UnifiedGetKlinesParams,
  UnifiedOrderParams,
  UnifiedOrderResponse,
  UnifiedPosition,
  UnifiedTicker,
} from "@/lib/exchange/types";
import type { Kline } from "@/lib/exchange/platform/tokocrypto";
import { INTERVAL_MS_MAP } from "@/lib/exchange/platform/tokocrypto";
import type { BacktestDatasetInterval, BacktestDatasetV1 } from "../dataset";
import type { BacktestMetricsRecorder } from "../metrics";

/** Logical clock contract shared with the backtest runner. */
export interface BacktestClock {
  now(): number;
}

export interface BacktestExchangeOptions {
  dataset: BacktestDatasetV1;
  clock: BacktestClock;
  /** Simulated quote-asset balance the run starts from. */
  startingQuoteAsset: number;
  /** Deterministic slippage in percentage points applied to every fill. */
  slippagePct?: number;
  metrics?: BacktestMetricsRecorder;
}

/** Static quantity precision used when no exchange info is available. */
const DEFAULT_STEP_BY_SYMBOL: Record<string, { minQty: number; stepSize: number }> = {
  BTC: { minQty: 0.001, stepSize: 0.001 },
  ETH: { minQty: 0.01, stepSize: 0.01 },
  BNB: { minQty: 0.01, stepSize: 0.01 },
  USDT: { minQty: 1, stepSize: 0.1 },
};

/**
 * Dataset-backed exchange adapter. Serves only candles visible at the logical
 * clock time, simulates deterministic fills at the latest visible one-minute
 * close, and never contacts a real exchange.
 */
export class BacktestExchange extends BinanceExchange {
  private readonly dataset: BacktestDatasetV1;
  private readonly clock: BacktestClock;
  private readonly slippagePct: number;
  private readonly metrics?: BacktestMetricsRecorder;
  private quoteAsset: number;
  private readonly baseAssets = new Map<string, number>();
  private readonly fills: UnifiedOrderResponse[] = [];
  private nextOrderId = 1;

  /** Returns the dataset key for one raw symbol request. */
  private toBaseSymbol(raw: string): string {
    return String(raw || "")
      .trim()
      .toUpperCase()
      .replace(/_USDT$/, "");
  }

  /** Returns the normalized pair form for one raw symbol request. */
  private toPairSymbol(raw: string): string {
    const base = this.toBaseSymbol(raw);
    return `${base}_USDT`;
  }

  constructor(options: BacktestExchangeOptions) {
    super();
    this.dataset = options.dataset;
    this.clock = options.clock;
    this.slippagePct = Math.max(0, options.slippagePct ?? 0);
    this.metrics = options.metrics;
    this.quoteAsset = options.startingQuoteAsset;
  }

  /** Returns the latest visible close of one symbol. */
  private latestVisiblePrice(symbol: string): number {
    const klines = this.visibleKlines(symbol, "1m");
    const close = Number.parseFloat(klines.at(-1)?.[4] ?? "");
    if (!Number.isFinite(close) || close <= 0) {
      throw new Error(`No visible price for ${symbol} at logical time`);
    }

    return close;
  }

  /** Returns dataset candles visible at the current logical time. */
  private visibleKlines(
    symbol: string,
    interval: BacktestDatasetInterval,
  ): Kline[] {
    const normalized = this.toBaseSymbol(symbol);
    const series = this.dataset.klines[normalized]?.[interval];
    if (!series) {
      throw new Error(
        `Backtest dataset has no ${interval} candles for ${normalized}`,
      );
    }

    const now = this.clock.now();
    const visible = series.filter((kline) => kline[6] <= now);
    if (visible.length === 0) {
      throw new Error(
        `No ${normalized} ${interval} candles are visible at ${now}`,
      );
    }

    return visible;
  }

  override async getKlines(
    params: UnifiedGetKlinesParams,
  ): Promise<Kline[]> {
    return this.metrics
      ? this.metrics.trackApiCall("getKlines", () =>
          Promise.resolve(this.getKlinesInternal(params)),
        )
      : Promise.resolve(this.getKlinesInternal(params));
  }

  private getKlinesInternal(params: UnifiedGetKlinesParams): Kline[] {
    const interval = params.interval as BacktestDatasetInterval;
    if (interval !== "1m" && interval !== "5m") {
      throw new Error(
        `Backtest supports only 1m and 5m candles, requested ${params.interval}`,
      );
    }

    const normalized = this.toBaseSymbol(params.symbol);
    const series = this.dataset.klines[normalized]?.[interval];
    if (!series) {
      throw new Error(
        `Backtest dataset has no ${interval} candles for ${normalized}`,
      );
    }

    const now = this.clock.now();
    const endTime = Math.min(params.endTime ?? now, now);
    const windowMs =
      params.simpleTime && INTERVAL_MS_MAP[params.simpleTime]
        ? INTERVAL_MS_MAP[params.simpleTime]
        : undefined;
    const requestedStart = params.startTime ?? (windowMs ? endTime - windowMs : undefined);

    const datasetStart = series[0][0];
    if (requestedStart !== undefined && requestedStart < datasetStart) {
      throw new Error(
        `Backtest dataset for ${normalized} ${interval} starts at ${datasetStart} but ${requestedStart} was requested; rebuild the dataset with a longer warmup`,
      );
    }

    let visible = series.filter((kline) => {
      if (kline[6] > endTime) return false;
      if (requestedStart !== undefined && kline[0] < requestedStart) {
        return false;
      }
      return true;
    });

    if (visible.length === 0) {
      throw new Error(
        `No ${normalized} ${interval} candles are visible at ${now}`,
      );
    }

    if (params.limit && params.limit > 0) {
      visible = visible.slice(-params.limit);
    }

    return visible;
  }

  override async createOrder(
    params: UnifiedOrderParams,
  ): Promise<UnifiedOrderResponse> {
    return this.metrics
      ? this.metrics.trackApiCall("createOrder", () =>
          Promise.resolve(this.createOrderInternal(params)),
        )
      : Promise.resolve(this.createOrderInternal(params));
  }

  private createOrderInternal(
    params: UnifiedOrderParams,
  ): UnifiedOrderResponse {
    // TC: BTEST:BACKTEST_MARKET_FILL
    const now = this.clock.now();
    const normalized = this.toPairSymbol(params.symbol);
    const base = this.toBaseSymbol(params.symbol);
    const rawPrice = this.latestVisiblePrice(base);
    const slipFactor = 1 + (this.slippagePct / 100);
    const fillPrice =
      params.side === "BUY" ? rawPrice * slipFactor : rawPrice / slipFactor;

    const quantity =
      params.quoteOrderQty && params.quoteOrderQty > 0
        ? params.quoteOrderQty / fillPrice
        : (params.quantity ?? 0);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`Backtest order rejected: invalid quantity ${quantity}`);
    }

    if (params.side === "BUY") {
      this.quoteAsset -= quantity * fillPrice;
      this.baseAssets.set(base, (this.baseAssets.get(base) ?? 0) + quantity);
    } else {
      this.quoteAsset += quantity * fillPrice;
      this.baseAssets.set(base, Math.max(0, (this.baseAssets.get(base) ?? 0) - quantity));
    }

    const response: UnifiedOrderResponse = {
      orderId: `backtest-${this.nextOrderId}`,
      clientId: params.clientId,
      symbol: normalized,
      side: params.side,
      type: params.type,
      status: "FILLED",
      targetPrice: params.price ?? fillPrice,
      quantity,
      executedQty: quantity,
      executedPrice: fillPrice,
      time: now,
      tradingMode: params.tradingMode,
      positionSide: params.positionSide?.toUpperCase() as
        | "LONG"
        | "SHORT"
        | "NET"
        | undefined,
    };
    this.nextOrderId += 1;
    this.fills.push(response);
    this.metrics?.recordFill();

    return response;
  }

  override async getBalance(symbol: string): Promise<UnifiedBalance | null> {
    const base = this.toBaseSymbol(symbol);
    return {
      quoteAsset: this.quoteAsset,
      baseAsset: this.baseAssets.get(base) ?? 0,
      available: this.quoteAsset,
    };
  }

  override async getPositions(symbol?: string): Promise<UnifiedPosition[]> {
    const symbols = symbol
      ? [this.toBaseSymbol(symbol)]
      : Array.from(this.baseAssets.keys());
    const positions: UnifiedPosition[] = [];
    for (const base of symbols) {
      const amount = this.baseAssets.get(base) ?? 0;
      if (amount <= 0) {
        continue;
      }
      const markPrice = this.latestVisiblePrice(base);
      const sizeUSDT = amount * markPrice;
      positions.push({
        symbol: `${base}_USDT`,
        originalSymbol: `${base}USDT`,
        side: "NET",
        amount,
        entryPrice: markPrice,
        markPrice,
        leverage: 1,
        sizeUSDT,
        marginUSDT: sizeUSDT,
        liquidationPrice: markPrice * 0.1,
      });
    }

    return positions;
  }

  override async getTickers(params?: {
    containSymbol?: string;
    marketType?: "SPOT" | "FUTURES";
  }): Promise<UnifiedTicker[]> {
    const symbols = params?.containSymbol
      ? [this.toBaseSymbol(params.containSymbol)]
      : this.dataset.symbols;
    const now = this.clock.now();
    const tickers: UnifiedTicker[] = [];
    for (const symbol of symbols) {
      const klines = this.visibleKlines(symbol, "1m");
      const lastKline = klines.at(-1);
      if (!lastKline) continue;
      const lastPrice = Number.parseFloat(lastKline[4]);
      const dayAgo = now - 24 * 60 * 60_000;
      const dayKlines = klines.filter((kline) => kline[6] > dayAgo);
      const volume24h = dayKlines.reduce(
        (sum, kline) => sum + Number.parseFloat(kline[7] || "0"),
        0,
      );
      const open24h = Number.parseFloat(dayKlines[0]?.[1] ?? lastKline[1]);
      const high24h = dayKlines.reduce(
        (max, kline) => Math.max(max, Number.parseFloat(kline[2])),
        0,
      );
      const low24h = dayKlines.reduce(
        (min, kline) =>
          min === 0
            ? Number.parseFloat(kline[3])
            : Math.min(min, Number.parseFloat(kline[3])),
        0,
      );
      if (!Number.isFinite(lastPrice) || lastPrice <= 0) continue;
      const changePercent =
        open24h > 0 ? ((lastPrice - open24h) / open24h) * 100 : 0;
      tickers.push({
        coin: symbol,
        exchange: "binance",
        symbol: `${symbol}_USDT`,
        lastPrice,
        open24h,
        changePercent,
        volume: volume24h,
        high24h,
        low24h,
        marketCap: 0,
      });
    }

    return tickers;
  }

  override async getOpenOrders(
    _symbol?: string,
    _options?: { tradingMode?: unknown },
  ): Promise<UnifiedOrderResponse[]> {
    return [];
  }

  override async getLastOrder(
    symbol: string,
  ): Promise<UnifiedOrderResponse | null> {
    const normalized = this.toPairSymbol(symbol);
    return this.fills.findLast((fill) => fill.symbol === normalized) ?? null;
  }

  override async cancelOrder(
    _orderId: string,
    _symbol?: string,
  ): Promise<boolean> {
    return true;
  }

  override async setLeverage(
    _symbol: string,
    _leverage: number,
  ): Promise<boolean> {
    return true;
  }

  override async repay(
    _symbol: string,
    _amount: number,
    _currency: string,
    _options?: { tradingMode?: string; repayCurrency?: string },
  ): Promise<boolean> {
    return true;
  }

  override async getFundingRates(_symbols?: string[]): Promise<never[]> {
    return [];
  }

  override async getGainers(params?: {
    marketType?: "SPOT" | "FUTURES";
    need?: number;
  }): Promise<UnifiedTicker[]> {
    return this.getTickers(params);
  }

  override async getMarketCap(_symbol: string): Promise<null> {
    return null;
  }

  override async getMinQtyAndStepSize(symbol: string): Promise<{
    minQty: number;
    stepSize: number;
  }> {
    const base = this.toBaseSymbol(symbol);
    return DEFAULT_STEP_BY_SYMBOL[base] ?? { minQty: 1, stepSize: 1 };
  }

  override async getTickSize(_symbol: string): Promise<number> {
    return 0.01;
  }

  override async withdrawAsset(
    _params: UnifiedWithdrawAssetParams,
  ): Promise<never> {
    throw new Error("Backtest cannot withdraw assets");
  }
}

const slowTradingBacktestExchange = {
  exchange: BacktestExchange,
} as const;

export default slowTradingBacktestExchange;
export { slowTradingBacktestExchange };
