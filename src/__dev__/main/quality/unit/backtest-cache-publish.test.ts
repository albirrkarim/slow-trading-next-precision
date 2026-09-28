import fs from "fs-extra";
import path from "path";
import { randomUUID } from "crypto";
import { afterEach, describe, expect, it } from "vitest";

import backtestResultCache from "@/lib/dev/backtestPrecision/api/cache";
import backtestArtifacts from "@/lib/dev/backtestPrecision/backtest/artifacts";
import type { BacktestChunkedResult } from "@/lib/dev/backtestPrecision/backtest/backtest-precision-types";
import type { Position } from "@/lib/system/trading";

describe("backtest cache publication", () => {
  const key = backtestResultCache.key({
    config: { test: randomUUID() },
    range: "6month",
  });
  const finalDir = backtestResultCache.dirFor(key);
  const stagingDirs: string[] = [];

  afterEach(async () => {
    await fs.remove(finalDir);
    for (const dir of stagingDirs) await fs.remove(dir);
  });

  it("hides incomplete parts and replaces leftovers from an interrupted run", async () => {
    const staleDir = path.join(finalDir, "positions");
    await fs.outputJson(path.join(staleDir, "part-000009.json"), [
      { notes: "stale" },
    ]);
    expect(await backtestResultCache.readMeta(key)).toBeNull();
    expect(await backtestResultCache.readField(key, "positions")).toBeNull();
    expect(await backtestResultCache.read(key)).toBeNull();

    const stagingDir = backtestResultCache.stagingDirFor(key);
    stagingDirs.push(stagingDir);
    const spool = backtestArtifacts.spool.create(stagingDir);
    await spool.pushPosition({ notes: "finished" } as Position);
    const parts = await spool.finalize();
    const result: BacktestChunkedResult = {
      counts: { closedPositions: 1, positions: 1, snapshots: 0, vPoints: 0 },
      exchangeType: "binance",
      parts,
      summary: { accounts: [], exits: {} },
    };
    await backtestResultCache.finalize(key, result, { range: "6month" }, stagingDir);
    expect(await backtestResultCache.readMeta(key)).toBeNull();

    await backtestResultCache.publish(key, stagingDir);
    expect((await backtestResultCache.readMeta(key))?.counts.positions).toBe(1);
    expect(await backtestResultCache.readField(key, "positions")).toEqual([
      { notes: "finished" },
    ]);
    expect(await fs.pathExists(path.join(staleDir, "part-000009.json"))).toBe(false);
  });
});
