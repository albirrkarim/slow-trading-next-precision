import type { Kline } from "@/lib/exchange/platform/tokocrypto";
import { BacktestExchange } from "@/lib/backtest/exchange";
import {
  UnifiedOrderSide,
  UnifiedOrderType,
} from "@/lib/exchange/types";
import type { BacktestDatasetV1 } from "@/lib/backtest/dataset";

const MINUTE_MS = 60_000;
const BASE_TIME = Date.UTC(2026, 5, 1, 0, 0, 0);

/** Builds one synthetic candle. */
function makeKline(
  openTime: number,
  close: number,
  intervalMs: number,
): Kline {
  return [
    openTime,
    String(close),
    String(close * 1.001),
    String(close * 0.999),
    String(close),
    "100",
    openTime + intervalMs - 1,
    String(close * 100),
    10,
    "50",
    String(close * 50),
    "0",
    "0",
  ];
}

/** Builds rising one-minute candles then returns the dataset around them. */
function makeDataset(): {
  dataset: BacktestDatasetV1;
  minuteCloses: number[];
} {
  const minuteCloses = Array.from(
    { length: 121 },
    (_, index) => 100 + index,
  );
  const oneMinute = minuteCloses.map((close, index) =>
    makeKline(BASE_TIME + index * MINUTE_MS, close, MINUTE_MS),
  );
  const fiveMinute = Array.from({ length: 25 }, (_, index) =>
    makeKline(BASE_TIME + index * 5 * MINUTE_MS, 100 + index * 5, 5 * MINUTE_MS),
  );

  return {
    dataset: {
      schema: 1,
      sourceExchangeType: "binance",
      marketType: "FUTURES",
      warmupStartTime: BASE_TIME,
      startTime: BASE_TIME + 60 * MINUTE_MS,
      endTime: BASE_TIME + 120 * MINUTE_MS,
      symbols: ["BTC"],
      klines: { BTC: { "1m": oneMinute, "5m": fiveMinute } },
    },
    minuteCloses,
  };
}

describe("backtest exchange adapter", () => {
  it("only returns candles already closed at the logical time", async () => {
    const { dataset } = makeDataset();
    const logicalNow = BASE_TIME + 10 * MINUTE_MS;
    const exchange = new BacktestExchange({
      dataset,
      clock: { now: () => logicalNow },
      startingQuoteAsset: 1000,
    });

    // TC: BOTH:BACKTEST_CANDLE_VISIBILITY
    const klines = await exchange.getKlines({
      symbol: "BTC_USDT",
      interval: "1m",
    });
    expect(klines.length).toBe(10);
    expect(klines.at(-1)?.[0]).toBe(BASE_TIME + 9 * MINUTE_MS);
  });

  it("fails clearly when candles before the dataset are requested", async () => {
    const { dataset } = makeDataset();
    const logicalNow = BASE_TIME + 10 * MINUTE_MS;
    const exchange = new BacktestExchange({
      dataset,
      clock: { now: () => logicalNow },
      startingQuoteAsset: 1000,
    });

    await expect(
      exchange.getKlines({
        symbol: "BTC_USDT",
        interval: "1m",
        startTime: BASE_TIME - 10 * MINUTE_MS,
        endTime: logicalNow,
      }),
    ).rejects.toThrow(/warmup/);
  });

  it("fills a market order at the latest visible one-minute close", async () => {
    const { dataset, minuteCloses } = makeDataset();
    const logicalNow = BASE_TIME + 10 * MINUTE_MS;
    const exchange = new BacktestExchange({
      dataset,
      clock: { now: () => logicalNow },
      startingQuoteAsset: 1000,
    });

    // TC: BTEST:BACKTEST_MARKET_FILL
    const fill = await exchange.createOrder({
      symbol: "BTC_USDT",
      tradeType: "ENTRY",
      side: UnifiedOrderSide.BUY,
      type: UnifiedOrderType.MARKET,
      quantity: 2,
    });
    expect(fill.status).toBe("FILLED");
    expect(fill.executedPrice).toBe(minuteCloses[9]);
    expect(fill.time).toBe(logicalNow);

    const balance = await exchange.getBalance("BTC_USDT");
    expect(balance?.quoteAsset).toBe(1000 - 2 * minuteCloses[9]);
    expect(balance?.baseAsset).toBe(2);
  });

  it("applies deterministic slippage to fills", async () => {
    const { dataset, minuteCloses } = makeDataset();
    const logicalNow = BASE_TIME + 10 * MINUTE_MS;
    const exchange = new BacktestExchange({
      dataset,
      clock: { now: () => logicalNow },
      startingQuoteAsset: 10_000,
      slippagePct: 1,
    });

    const fill = await exchange.createOrder({
      symbol: "BTC_USDT",
      tradeType: "ENTRY",
      side: UnifiedOrderSide.BUY,
      type: UnifiedOrderType.MARKET,
      quantity: 1,
    });
    expect(fill.executedPrice).toBeCloseTo(minuteCloses[9] * 1.01, 6);
  });

  it("refuses unsupported candle intervals", async () => {
    const { dataset } = makeDataset();
    const exchange = new BacktestExchange({
      dataset,
      clock: { now: () => BASE_TIME + 10 * MINUTE_MS },
      startingQuoteAsset: 1000,
    });

    await expect(
      exchange.getKlines({ symbol: "BTC_USDT", interval: "15m" }),
    ).rejects.toThrow(/1m and 5m/);
  });

  it("refuses withdrawals", async () => {
    const { dataset } = makeDataset();
    const exchange = new BacktestExchange({
      dataset,
      clock: { now: () => BASE_TIME + 10 * MINUTE_MS },
      startingQuoteAsset: 1000,
    });

    await expect(
      exchange.withdrawAsset({
        asset: "USDT",
        address: "anywhere",
        amount: 1,
      }),
    ).rejects.toThrow(/withdraw/);
  });
});
