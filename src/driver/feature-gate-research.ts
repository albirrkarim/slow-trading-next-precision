import { createHash } from "node:crypto";
import path from "node:path";
import fs from "fs-extra";

import { precisionBacktest } from "@/lib/dev/backtestPrecision/backtest";
import type { BacktestPrecisionParams } from "@/lib/dev/backtestPrecision/api/precision-api-types";
import entry from "@/lib/system/trading/entry";
import type { Kline } from "@/lib/system/types/market";

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/** Verifies local coverage before the normal preparation step can request a download. */
async function checkCoverage(params: BacktestPrecisionParams): Promise<void> {
  const start = params.startTime!;
  const end = params.endTime!;
  for (const symbol of entry.getSymbols(params.config)) {
    for (let day = Math.floor(start / DAY_MS) * DAY_MS; day < end; day += DAY_MS) {
      const key = new Date(day).toISOString().slice(0, 10);
      const file = path.resolve("storage/datasets/PRECISION_BACKTEST/1m", symbol, `${key}.json`);
      if (!(await fs.pathExists(file))) {
        throw new Error(`Missing local dataset: ${symbol} ${key}. Research does not download candles.`);
      }
      const candles = await fs.readJson(file) as Kline[];
      const expected = Math.floor((Math.min(day + DAY_MS, end) - 1) / MINUTE_MS) * MINUTE_MS;
      const last = candles.at(-1)?.[0];
      if ((last !== undefined && last < expected) ||
          (!candles.length && day === Math.floor(Date.now() / DAY_MS) * DAY_MS)) {
        throw new Error(`Incomplete local dataset: ${symbol} ${key}. Choose an earlier end time.`);
      }
    }
  }
}

/** Hashes the strategy files so saved experiments identify their entry policy. */
async function policyHash(): Promise<string> {
  const hash = createHash("sha256");
  for (const file of ["index.ts", "feature_gate_v2.ts", "feature_gate_regimes.ts"]) {
    hash.update(file);
    hash.update(await fs.readFile(path.resolve("src/lib/strategies/default_with_features_gate", file)));
  }
  return hash.digest("hex");
}

/** Replays the current strategy at fixed cached timestamps into a fresh research directory. */
async function main(): Promise<void> {
  const [source, name, symbols, start, end] = process.argv.slice(2);
  if (!source || !name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error(
      "Usage: tsx -r tsconfig-paths/register src/driver/feature-gate-research.ts " +
      "<cache-dir> <new-run-name> [comma-separated-symbols|-] [start-ISO] [end-ISO]",
    );
  }
  const meta = await fs.readJson(path.join(source, "meta.json"));
  const params: BacktestPrecisionParams = {
    ...meta.params,
    config: structuredClone(meta.params.config),
    initialState: undefined,
    startTime: start ? Date.parse(start) : meta.dataset?.startTime,
    endTime: end ? Date.parse(end) : meta.dataset?.endTime,
    upToDateKlines: false,
  };
  if (!Number.isFinite(params.startTime) || !Number.isFinite(params.endTime) ||
      params.startTime! >= params.endTime!) {
    throw new Error("Research requires a finite, fixed dataset window.");
  }
  if (symbols && symbols !== "-") {
    params.config.management.symbols = symbols.split(",").map((symbol) => symbol.trim().toUpperCase());
  }
  const dir = path.resolve("storage/research/feature-gate", name);
  if (await fs.pathExists(dir)) throw new Error(`Research run already exists: ${dir}`);
  const hash = await policyHash();
  await checkCoverage(params);
  const started = Date.now();
  const result = await precisionBacktest({ ...params, artifacts: { dir } });
  await fs.writeJson(path.join(dir, "meta.json"), {
    ...result,
    v: 4,
    createdAt: Date.now(),
    params,
    research: { source: path.resolve(source), policyHash: hash, elapsedMs: Date.now() - started },
  });
  console.log(JSON.stringify({ dir, counts: result.counts, accounts: result.summary.accounts }));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
