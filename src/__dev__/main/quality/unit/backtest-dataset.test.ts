import type { Kline } from "@/lib/exchange/platform/tokocrypto";
import type { BacktestDatasetV1 } from "@/lib/backtest/dataset";
import { validateBacktestDataset } from "@/lib/backtest/dataset";

const MINUTE_MS = 60_000;

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

/** Builds a flat contiguous candle series. */
function makeSeries(
  startTime: number,
  count: number,
  intervalMs: number,
  close: number,
): Kline[] {
  return Array.from(
    { length: count },
    (_, index) => makeKline(startTime + index * intervalMs, close, intervalMs),
  );
}

const BASE_TIME = Date.UTC(2026, 5, 1, 0, 0, 0);

function makeDataset(overrides?: {
  klines?: Record<string, { "1m": Kline[]; "5m": Kline[] }>;
  symbols?: string[];
}): BacktestDatasetV1 {
  const symbols = overrides?.symbols ?? ["BTC"];
  const klines =
    overrides?.klines ??
    Object.fromEntries(
      symbols.map((symbol) => [
        symbol,
        {
          "1m": makeSeries(BASE_TIME, 121, MINUTE_MS, 100),
          "5m": makeSeries(BASE_TIME, 25, 5 * MINUTE_MS, 100),
        },
      ]),
    );

  return {
    schema: 1,
    sourceExchangeType: "binance",
    marketType: "FUTURES",
    warmupStartTime: BASE_TIME,
    startTime: BASE_TIME + 60 * MINUTE_MS,
    endTime: BASE_TIME + 120 * MINUTE_MS,
    symbols,
    klines,
  };
}

describe("backtest dataset", () => {
  it("accepts a contiguous dataset", () => {
    expect(() => validateBacktestDataset(makeDataset())).not.toThrow();
  });

  it("rejects a dataset without BTC candles", () => {
    expect(() =>
      validateBacktestDataset(makeDataset({ symbols: ["SUI"] })),
    ).toThrow(/BTC/);
  });

  it("rejects duplicate candle times", () => {
    const dataset = makeDataset();
    const oneMinute = dataset.klines.BTC["1m"];
    oneMinute[10] = oneMinute[9];
    expect(() => validateBacktestDataset(dataset)).toThrow(/duplicate/i);
  });

  it("rejects reversed candle ranges", () => {
    const dataset = makeDataset();
    const oneMinute = dataset.klines.BTC["1m"];
    [oneMinute[50], oneMinute[51]] = [oneMinute[51], oneMinute[50]];
    expect(() => validateBacktestDataset(dataset)).toThrow(/reversed|gap/i);
  });

  it("rejects candle gaps", () => {
    const dataset = makeDataset();
    dataset.klines.BTC["1m"].splice(50, 1);
    expect(() => validateBacktestDataset(dataset)).toThrow(/gap/i);
  });

  it("rejects missing coverage of the run window", () => {
    const dataset = makeDataset();
    dataset.klines.BTC["1m"] = dataset.klines.BTC["1m"].slice(0, 30);
    expect(() => validateBacktestDataset(dataset)).toThrow(/covers/i);
  });
});
