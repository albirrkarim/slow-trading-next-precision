import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import backtestArtifacts from "@/lib/dev/backtestPrecision/backtest/artifacts";
import type { BacktestBalanceSnapshot } from "@/lib/dev/backtestPrecision/backtest/backtest-precision-types";
import type { Position } from "@/lib/system/trading";
import type { VolatilityPoint } from "@/lib/system/types";

const position = (id: number) =>
  ({ notes: `p${id}` }) as unknown as Position;

const vPoint = (id: string, t: number): VolatilityPoint =>
  ({ id, t }) as unknown as VolatilityPoint;

const snapshot = (t: number, total: number): BacktestBalanceSnapshot => ({
  available: total,
  locked: 0,
  reserved: 0,
  safeHaven: 0,
  spendable: total,
  startingBalance: total,
  t,
  total,
});

// BTEST:RESULT_ARTIFACT_CHUNKS — run artifacts stream to part files in
// fixed-size chunks so long backtests never retain the whole result set.
describe("backtest artifact spool", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "backtest-artifacts-"));
  });

  afterEach(async () => {
    await fs.remove(dir);
  });

  it("flushes positions to numbered parts at the chunk boundary", async () => {
    const spool = backtestArtifacts.spool.create(dir, 3);

    for (let i = 0; i < 7; i++) {
      await spool.pushPosition(position(i));
    }
    const manifest = await spool.finalize();

    expect(manifest).toEqual({
      features: {},
      positions: 3,
      snapshots: {},
      vpoints: {},
    });
    const partDir = path.join(dir, "positions");
    expect((await fs.readdir(partDir)).sort()).toEqual([
      "part-000000.json",
      "part-000001.json",
      "part-000002.json",
    ]);
    expect(
      await fs.readJson(path.join(partDir, "part-000000.json")),
    ).toHaveLength(3);
    expect(
      await fs.readJson(path.join(partDir, "part-000002.json")),
    ).toHaveLength(1);

    const positions = await backtestArtifacts.read.positions(dir);
    expect(positions.map((p) => p.notes)).toEqual([
      "p0",
      "p1",
      "p2",
      "p3",
      "p4",
      "p5",
      "p6",
    ]);
  });

  it("streams vpoints per symbol and reads them scoped or merged", async () => {
    const spool = backtestArtifacts.spool.create(dir, 2);

    await spool.pushVPoint("AAA", vPoint("a1", 1));
    await spool.pushVPoint("BBB", vPoint("b1", 2));
    await spool.pushVPoint("AAA", vPoint("a2", 3));
    await spool.pushVPoint("AAA", vPoint("a3", 4));
    const manifest = await spool.finalize();

    expect(manifest.vpoints).toEqual({ AAA: 2, BBB: 1 });

    const scoped = await backtestArtifacts.read.vpoints(dir, "AAA");
    expect((scoped as VolatilityPoint[]).map((p) => p.id)).toEqual([
      "a1",
      "a2",
      "a3",
    ]);

    const merged = (await backtestArtifacts.read.vpoints(dir)) as Record<
      string,
      VolatilityPoint[]
    >;
    expect(Object.keys(merged).sort()).toEqual(["AAA", "BBB"]);
    expect(merged.BBB.map((p) => p.id)).toEqual(["b1"]);
  });

  it("replaces a buffered snapshot on a repeated timestamp", async () => {
    const spool = backtestArtifacts.spool.create(dir, 10);

    await spool.pushSnapshot("main", snapshot(1000, 100));
    await spool.pushSnapshot("main", snapshot(1000, 120));
    await spool.pushSnapshot("main", snapshot(2000, 130));
    const manifest = await spool.finalize();

    expect(manifest.snapshots).toEqual({ main: 1 });
    const snapshots = (await backtestArtifacts.read.snapshots(
      dir,
      "main",
    )) as BacktestBalanceSnapshot[];
    expect(snapshots.map((s) => [s.t, s.total])).toEqual([
      [1000, 120],
      [2000, 130],
    ]);
  });

  it("streams features per symbol and reads them scoped or merged", async () => {
    const spool = backtestArtifacts.spool.create(dir, 2);

    await spool.pushFeature("AAA", {
      priceNormalized: 0.4,
      priceNormalizedHistory: [],
      t: 1,
    });
    await spool.pushFeature("BBB", {
      priceNormalized: 0.9,
      priceNormalizedHistory: [],
      t: 2,
    });
    await spool.pushFeature("AAA", {
      priceNormalized: 0.6,
      priceNormalizedHistory: [],
      t: 3,
    });
    await spool.pushFeature("AAA", {
      priceNormalized: 1.1,
      priceNormalizedHistory: [],
      t: 4,
    });
    const manifest = await spool.finalize();

    expect(manifest.features).toEqual({ AAA: 2, BBB: 1 });

    const scoped = (await backtestArtifacts.read.features(
      dir,
      "AAA",
    )) as { t: number; priceNormalized?: number }[];
    expect(scoped.map((record) => record.priceNormalized)).toEqual([
      0.4, 0.6, 1.1,
    ]);

    const merged = (await backtestArtifacts.read.features(dir)) as Record<
      string,
      { t: number }[]
    >;
    expect(Object.keys(merged).sort()).toEqual(["AAA", "BBB"]);
    expect(merged.BBB.map((record) => record.t)).toEqual([2]);
  });

  it("handles an empty run", async () => {
    const spool = backtestArtifacts.spool.create(dir, 5);
    const manifest = await spool.finalize();

    expect(manifest).toEqual({
      features: {},
      positions: 0,
      snapshots: {},
      vpoints: {},
    });
    expect(await backtestArtifacts.read.positions(dir)).toEqual([]);
    expect(await backtestArtifacts.read.vpoints(dir)).toEqual({});
    expect(await backtestArtifacts.read.snapshots(dir)).toEqual({});
    expect(await backtestArtifacts.read.features(dir)).toEqual({});
  });
});
