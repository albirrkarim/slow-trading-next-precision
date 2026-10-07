import fs from "fs-extra";
import path from "path";
import { createHash, randomUUID } from "crypto";
import { afterEach, describe, expect, it } from "vitest";

import backtestResultCache from "@/lib/dev/backtestPrecision/api/cache";
import backtestArtifacts from "@/lib/dev/backtestPrecision/backtest/artifacts";
import type { BacktestChunkedResult } from "@/lib/dev/backtestPrecision/backtest/backtest-precision-types";
import type { Position } from "@/lib/system/trading";

describe("backtest cache publication", () => {
  it("keys the identity on the v10 simulation version, not v9", () => {
    const identity = { config: {}, range: "6month" };
    const hash = (version: number) =>
      createHash("sha256")
        .update(`{"config":{},"range":"6month","v":${version}}`)
        .digest("hex");

    expect(backtestResultCache.key(identity)).toBe(hash(10));
    expect(backtestResultCache.key(identity)).not.toBe(hash(9));
  });

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

  it("round-trips the Black Swan timeline through meta and full reads", async () => {
    const timeline = {
      enabled: true,
      endTime: 2_000,
      segments: [
        { reason: "HEALTHY", status: "NORMAL", t: 1_000 },
        { reason: "BTC_HARD_TRIGGER", status: "CRISIS", t: 1_500 },
      ],
      startTime: 1_000,
    } as const;
    const stagingDir = backtestResultCache.stagingDirFor(key);
    stagingDirs.push(stagingDir);
    const spool = backtestArtifacts.spool.create(stagingDir);
    await spool.pushPosition({ notes: "with timeline" } as Position);
    const parts = await spool.finalize();
    const result: BacktestChunkedResult = {
      blackSwanTimeline: timeline as never,
      counts: { closedPositions: 1, positions: 1, snapshots: 0, vPoints: 0 },
      exchangeType: "binance",
      parts,
      summary: { accounts: [], exits: {} },
    };
    await backtestResultCache.finalize(key, result, { range: "6month" }, stagingDir);
    await backtestResultCache.publish(key, stagingDir);

    const metaRaw = await fs.readFile(
      path.join(finalDir, "meta.json"),
      "utf-8",
    );
    expect(metaRaw.trimEnd()).not.toContain("\n");
    expect(JSON.parse(metaRaw).blackSwanTimeline).toEqual(timeline);

    expect((await backtestResultCache.readMeta(key))?.blackSwanTimeline).toEqual(
      timeline,
    );
    expect((await backtestResultCache.read(key))?.blackSwanTimeline).toEqual(
      timeline,
    );
    expect(
      (await backtestResultCache.listMetas()).find(
        (entry) => entry.cacheKey === key,
      )?.blackSwanTimeline,
    ).toEqual(timeline);
  });

  it("keeps an existing dataset dir when a rerun produced none", async () => {
    const result: BacktestChunkedResult = {
      counts: { closedPositions: 1, positions: 1, snapshots: 0, vPoints: 0 },
      exchangeType: "binance",
      parts: { positions: 0, vpoints: {}, snapshots: {}, features: {} },
      summary: { accounts: [], exits: {} },
    };
    const runOnce = async (rows?: { missScore: number }[]) => {
      const stagingDir = backtestResultCache.stagingDirFor(key);
      stagingDirs.push(stagingDir);
      if (rows) {
        await fs.outputJson(path.join(stagingDir, "dataset", "AAA.json"), rows);
      }
      await backtestResultCache.finalize(key, result, { range: "6month" }, stagingDir);
      await backtestResultCache.publish(key, stagingDir);
    };

    const datasetFile = path.join(finalDir, "dataset", "AAA.json");
    await runOnce([{ missScore: 0 }]);
    expect(await fs.readJson(datasetFile)).toEqual([{ missScore: 0 }]);

    await runOnce(undefined);
    expect(await fs.readJson(datasetFile)).toEqual([{ missScore: 0 }]);

    await runOnce([{ missScore: 9 }]);
    expect(await fs.readJson(datasetFile)).toEqual([{ missScore: 9 }]);
  });

  it("reads legacy meta entries without a timeline as undefined", async () => {
    const stagingDir = backtestResultCache.stagingDirFor(key);
    stagingDirs.push(stagingDir);
    const spool = backtestArtifacts.spool.create(stagingDir);
    await spool.pushPosition({ notes: "legacy" } as Position);
    const parts = await spool.finalize();
    const result: BacktestChunkedResult = {
      counts: { closedPositions: 1, positions: 1, snapshots: 0, vPoints: 0 },
      exchangeType: "binance",
      parts,
      summary: { accounts: [], exits: {} },
    };
    await backtestResultCache.finalize(key, result, { range: "6month" }, stagingDir);
    await backtestResultCache.publish(key, stagingDir);

    const metaPath = path.join(finalDir, "meta.json");
    const meta = await fs.readJson(metaPath);
    delete meta.blackSwanTimeline;
    await fs.writeJson(metaPath, meta);

    expect((await backtestResultCache.readMeta(key))?.blackSwanTimeline).toBeUndefined();
    expect((await backtestResultCache.read(key))?.blackSwanTimeline).toBeUndefined();
  });
});
