import dotenv from "dotenv";

dotenv.config();

import fs from "fs-extra";
import v8 from "v8";
import { RuntimeEngine } from "@/lib/precision";
import type {
  RuntimeEngineAdapter,
  RuntimeEngineState,
} from "@/lib/precision/types";
import type { VolatilityPoint } from "@/lib/system/types";
import { getFeeCalculator } from "@/lib/exchange/fees";
import tradingAveraging from "@/lib/system/trading/averaging";
import entryAction from "@/lib/system/trading/entry-action";
import tradingExit from "@/lib/system/trading/exit";
import { preparePrecisionDataset } from "@/lib/dev/backtestPrecision/backtest/data";
import {
  createInitialBalance,
  createInitialVPointsMap,
  createProgressLogger,
} from "@/lib/dev/backtestPrecision/backtest/utils";
import type { BacktestPrecisionParams } from "@/lib/dev/backtestPrecision/api/precision-api-types";

const VPOINT_WARMUP_MS = 2 * 30 * 24 * 60 * 60_000;
const SNAPSHOT_AT_MB = Number(process.env.HEAP_SNAPSHOT_AT_MB ?? 1500);
const LOG_EVERY_MS = Number(process.env.HEAP_LOG_EVERY_MS ?? 10_000);

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(0)}MB`;
}

function countPoints(map: Record<string, VolatilityPoint[]>): number {
  let n = 0;
  for (const points of Object.values(map)) n += points.length;
  return n;
}

async function main() {
  const metaPath = process.argv[2];
  if (!metaPath) {
    throw new Error("Usage: backtest-precision <path-to-cache-meta.json>");
  }

  const meta = await fs.readJson(metaPath);
  const params = meta.params as BacktestPrecisionParams;

  const dataset = await preparePrecisionDataset(params);
  const { symbols } = dataset;
  const endTime = dataset.endTime;
  const currentTime = dataset.startTime + VPOINT_WARMUP_MS;

  const vPointsMap = await createInitialVPointsMap(
    symbols,
    dataset.getKlines,
    dataset.startTime,
    currentTime,
  );
  const detectedVPoints: Record<string, VolatilityPoint[]> = {};

  const state: RuntimeEngineState = {
    balance: createInitialBalance(params),
    entryCutoffTime: endTime - 4 * 24 * 60 * 60 * 1000,
    config: params.config,
    currentTime,
    mode: "backtest",
    openPositions: [],
    markPriceMap: {},
    vPointsMap,
  };
  let clockTime = state.currentTime;
  const history: RuntimeEngineState["openPositions"] = [];
  let actionCount = 0;
  let getKlinesCalls = 0;
  let getKlinesItems = 0;

  const logProgress = createProgressLogger(
    clockTime,
    endTime,
    () => history.length,
  );

  const adapter: RuntimeEngineAdapter = {
    clock: {
      advanceTo(time) {
        clockTime = Math.min(time, endTime);
        logProgress(clockTime);
      },
      finished() {
        return clockTime >= endTime;
      },
      now() {
        return clockTime;
      },
    },
    market: {
      getKlines: async (request) => {
        getKlinesCalls += 1;
        const klines = await dataset.getKlines(request);
        getKlinesItems += klines.length;
        return klines;
      },
    },
    exchange: {
      getFeeRate({ side, type }) {
        return (
          getFeeCalculator(params.config.management.exchangeType)
            .getTotalFeePercent({ currency: "USDT", side, type }) / 100
        );
      },
      getRoundTripFeeRate({ type }) {
        return (
          getFeeCalculator(params.config.management.exchangeType)
            .getBothSideFeePercent({ currency: "USDT", type }) / 100
        );
      },
    },
    onAction: async (decision, context) => {
      actionCount += 1;
      return decision.type === "entry"
        ? await entryAction.execute(context, decision)
        : decision.type === "averaging"
          ? await tradingAveraging.execute(context, decision)
          : decision.type === "exit"
            ? await tradingExit.execute(context, decision)
            : null;
    },
    onExit: async (position) => {
      history.push(position);
    },
    onNewVPoint: async (symbol, newVPoint) => {
      (detectedVPoints[symbol] ??= []).push(newVPoint);
    },
    onNotif: () => true,
  };

  let snapshotTaken = false;
  const memTimer = setInterval(() => {
    const heap = v8.getHeapStatistics();
    const usedMb = heap.used_heap_size / 1024 / 1024;
    console.log(
      `[mem] ${new Date(clockTime).toISOString().slice(0, 10)} ` +
        `used=${mb(heap.used_heap_size)} ` +
        `hist=${history.length} open=${state.openPositions.length} ` +
        `vp=${countPoints(detectedVPoints)} live=${countPoints(state.vPointsMap)} ` +
        `actions=${actionCount} klineCalls=${getKlinesCalls} klines=${getKlinesItems}`,
    );
    if (!snapshotTaken && usedMb >= SNAPSHOT_AT_MB) {
      snapshotTaken = true;
      const file = v8.writeHeapSnapshot();
      console.log(`[mem] heap snapshot written: ${file}`);
      process.exit(2);
    }
  }, LOG_EVERY_MS);
  memTimer.unref();

  const engine = new RuntimeEngine(state, adapter);
  await engine.start();
  clearInterval(memTimer);
  console.log(`DONE positions=${history.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
