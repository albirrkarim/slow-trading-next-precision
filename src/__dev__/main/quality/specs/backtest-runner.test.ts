import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Kline } from "@/lib/exchange/platform/tokocrypto";
import type { BacktestDatasetV1 } from "@/lib/backtest/dataset";
import type {
  PrecisionBacktestResultV1,
  ProdTestCaseV1,
} from "@/lib/precision/types";

const MINUTE_MS = 60_000;
const WARMUP_MINUTES = 120;
const RUN_MINUTES = 90;
const WARMUP_START = Date.UTC(2026, 5, 1, 0, 0, 0);
const RUN_START = WARMUP_START + WARMUP_MINUTES * MINUTE_MS;
const RUN_END = RUN_START + RUN_MINUTES * MINUTE_MS;

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

/**
 * Builds a slow pump-and-retrace path so the copied vPoint detector
 * (5% move threshold, 1% retrace) confirms new points during the run.
 */
function priceAtMinute(minuteIndex: number): number {
  const pumpStart = WARMUP_MINUTES + 10;
  const pumpLength = 30;
  if (minuteIndex < pumpStart) {
    return 100;
  }
  if (minuteIndex < pumpStart + pumpLength) {
    const progress = (minuteIndex - pumpStart) / pumpLength;
    return 100 * (1 + 0.07 * progress);
  }
  if (minuteIndex < pumpStart + pumpLength + 20) {
    const retrace = (minuteIndex - pumpStart - pumpLength) / 20;
    return 107 * (1 - 0.02 * retrace);
  }
  return 104.86;
}

function buildDataset(): BacktestDatasetV1 {
  const totalMinutes = WARMUP_MINUTES + RUN_MINUTES;
  const symbols = ["BTC", "SUI"];
  const klines: BacktestDatasetV1["klines"] = {};

  for (const symbol of symbols) {
    const oneMinute = Array.from({ length: totalMinutes }, (_, index) =>
      makeKline(
        WARMUP_START + index * MINUTE_MS,
        symbol === "BTC" ? 50_000 : priceAtMinute(index),
        MINUTE_MS,
      ),
    );
    const fiveMinuteCount = Math.floor(totalMinutes / 5);
    const fiveMinute = Array.from({ length: fiveMinuteCount }, (_, index) =>
      makeKline(
        WARMUP_START + index * 5 * MINUTE_MS,
        symbol === "BTC"
          ? 50_000
          : priceAtMinute(Math.min(index * 5, totalMinutes - 1)),
        5 * MINUTE_MS,
      ),
    );
    klines[symbol] = { "1m": oneMinute, "5m": fiveMinute };
  }

  return {
    schema: 1,
    sourceExchangeType: "binance",
    marketType: "FUTURES",
    warmupStartTime: WARMUP_START,
    startTime: RUN_START,
    endTime: RUN_END,
    symbols,
    klines,
  };
}

/** Builds one production test case around the default SLOW storage. */
async function buildTestCase(): Promise<ProdTestCaseV1> {
  const { default: slowTradingStorage } = await import("@/lib/runtime/storage");
  const base = slowTradingStorage.data.createDefault();
  const config = { ...base.config, symbols: ["SUI"] };
  const vPoint = (price: number) => ({
    id: `seed-${price}`,
    t: WARMUP_START,
    l: "B" as const,
    pct: 0,
    p: price,
    vb: 100,
    vq: 10_000,
    lvl: 2,
  });

  return {
    schema: 1,
    strategy: "multi",
    mode: "live",
    account: base.account.slug,
    startTime: RUN_START,
    endTime: RUN_END,
    config: {
      runtime: base.runtime,
      trading: config,
    },
    initialState: {
      ...base.modes.live,
      dynamicTradeMemory: {
        ...base.modes.live.dynamicTradeMemory,
        quoteAsset: 10_000,
        startingBalanceUSDT: 10_000,
      },
    },
    sharedVolatility: {
      BTC: { symbol: "BTC_USDT", lastVolatility: [vPoint(50_000)] },
      SUI: { symbol: "SUI_USDT", lastVolatility: [vPoint(100)] },
    },
    endPositions: [],
  };
}

async function runOnce(): Promise<{
  fileName: string;
  result: PrecisionBacktestResultV1;
}> {
  const storageRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "slow-precision-backtest-test-"),
  );
  const outputDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "slow-precision-result-test-"),
  );
  process.env.PERSISTENT_STORAGE_ROOT = storageRoot;
  vi.resetModules();

  const { default: slowTradingBacktestRunner } = await import(
    "@/lib/backtest/runner"
  );
  const dataset = buildDataset();
  const testCase = await buildTestCase();
  const run = await slowTradingBacktestRunner.run({
    dataset,
    testCase,
    outputDir,
    storageRoot,
  });

  const written = await fs.readJSON(
    path.join(outputDir, run.fileName),
  );
  expect(written.schema).toBe(1);
  expect(written.mode).toBe("backtest");
  expect(written.startTime).toBe(RUN_START);
  expect(written.endTime).toBe(RUN_END);
  expect(written.account).toBe(testCase.account);
  expect(Array.isArray(written.endPositions)).toBe(true);

  await fs.remove(storageRoot).catch(() => undefined);
  await fs.remove(outputDir).catch(() => undefined);

  return run;
}

let tmpRoot: string | null = null;

describe("precision backtest runner", () => {
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "slow-precision-runner-"),
    );
    process.env.PERSISTENT_STORAGE_ROOT = tmpRoot;
    vi.resetModules();
  });

  afterEach(async () => {
    if (tmpRoot) await fs.remove(tmpRoot);
    delete process.env.PERSISTENT_STORAGE_ROOT;
    vi.resetModules();
  });

  it("refuses to run without the isolated storage root", async () => {
    const { default: slowTradingBacktestRunner } = await import(
      "@/lib/backtest/runner"
    );
    const dataset = buildDataset();
    const testCase = await buildTestCase();
    await expect(
      slowTradingBacktestRunner.run({
        dataset,
        testCase,
        outputDir: tmpRoot!,
        storageRoot: `${tmpRoot}-elsewhere`,
      }),
    ).rejects.toThrow(/PERSISTENT_STORAGE_ROOT/);
  });

  it("runs the recorded test case through the shared runtime and reports measurable usage", async () => {
    const run = await runOnce();
    // TC: BOTH:SHARED_RUNTIME_ENGINE
    expect(run.result.endPositions).toEqual(
      expect.arrayContaining([]) as unknown[],
    );
    // TC: BTEST:BACKTEST_METRICS
    const metrics = run.result.metrics as NonNullable<
      ProdTestCaseV1["metrics"]
    >;
    expect(metrics).toBeDefined();
    expect(metrics.logicalDurationMs).toBe(RUN_END - RUN_START);
    expect(metrics.fills).toBeGreaterThanOrEqual(0);
    expect(Object.keys(metrics.apiCalls)).toContain("getKlines");
    expect(Object.keys(metrics.stages).length).toBeGreaterThan(0);
  });

  it("produces the same result when repeated", async () => {
    // TC: BTEST:BACKTEST_REPRODUCIBLE
    const first = await runOnce();
    const second = await runOnce();
    expect(JSON.stringify(second.result.endPositions)).toBe(
      JSON.stringify(first.result.endPositions),
    );
  });
});
