import fs from "fs-extra";
import os from "os";
import path from "path";
import { describe, expect, it, vi } from "vitest";

import backtestResultCache from "@/lib/dev/backtestPrecision/api/cache";
import featureGateDataset from "@/lib/dev/backtestPrecision/feature-gate-dataset";
import featureGate from "@/lib/dev/feature-gate";
import datasetFilters from "@/lib/dev/feature-gate/filters";
import type { FeatureGateDatasetRow } from "@/lib/dev/feature-gate";
import type { NumericFilterOperator } from "@/lib/system/utils/numeric-filter";

const HASH = "a".repeat(64);
const row = (score?: number, t = 100): FeatureGateDatasetRow => ({
  symbol: "AAA", t, resolved: score !== undefined, missScore: score,
  sequences: [{ id: "start", t: 1, lvl: -2, l: "B", p: 100, pct: 5, vb: 0, vq: 0 }],
  feature: { shared: {}, coins: {
    AAA: { priceNormalized: { current: -0.2, history: [] } },
    BTC: { priceNormalized: { current: 0.7, history: [] } },
  } },
});

// BTEST:FEATURE_GATE_DATASET — conditions apply to the complete dataset before pagination.
describe("dataset filter conditions", () => {
  it("uses every numeric operator and excludes absent outcomes from active conditions", () => {
    const rows = [row(0), row(1), row(2), row(undefined)];
    const run = (operator: NumericFilterOperator) => rows.filter((r) => datasetFilters.matches(r, {
      hash: HASH, metric: "missScore", operator, value: 1,
    })).map((r) => r.missScore);
    expect(run("lt")).toEqual([0]);
    expect(run("lte")).toEqual([0, 1]);
    expect(run("eq")).toEqual([1]);
    expect(run("gte")).toEqual([1, 2]);
    expect(run("gt")).toEqual([2]);
  });

  it("combines symbol, inclusive capture dates and the metric condition", () => {
    const query = { hash: HASH, symbol: "AAA", fromT: 100, toT: 200, metric: "signalLevel", operator: "eq", value: 2 } as const;
    expect([row(0, 99), row(0, 100), row(0, 200), row(0, 201)]
      .filter((r) => datasetFilters.matches(r, query)).map((r) => r.t)).toEqual([100, 200]);
    expect(datasetFilters.matches({ ...row(0), symbol: "BBB" }, query)).toBe(false);
    expect(datasetFilters.matches({ ...row(0), t: undefined }, query)).toBe(false);
  });

  it("reads the own coin and BTC features independently and excludes missing or nonfinite inputs", () => {
    const query = { hash: HASH, metric: "priceNormalized", operator: "lt", value: 0 } as const;
    expect(datasetFilters.matches(row(0), query)).toBe(true);
    expect(datasetFilters.matches(row(0), { ...query, metric: "btcPriceNormalized" })).toBe(false);
    expect(datasetFilters.matches({ ...row(0), feature: undefined }, query)).toBe(false);
    expect(datasetFilters.matches({ ...row(0), missScore: Number.NaN }, { ...query, metric: "missScore" })).toBe(false);
  });

  it("rejects incomplete, unknown and nonnumeric API conditions", () => {
    expect(datasetFilters.parseCondition()).toEqual({});
    expect(datasetFilters.parseCondition("priceNormalized", "lt", "-0.2")).toEqual({ metric: "priceNormalized", operator: "lt", value: -0.2 });
    for (const args of [["missScore"], ["missScore", "gt"], ["constructor", "eq", "1"], ["missScore", "constructor", "1"], ["missScore", "eq", ""], ["missScore", "eq", "NaN"], ["missScore", "eq", "Infinity"]]) {
      expect(() => datasetFilters.parseCondition(...args)).toThrow(/valid.*metric/);
    }
  });

  it("filters before pagination, preserves the full symbol list, and keeps legacy filters working", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dataset-filters-"));
    const cache = vi.spyOn(backtestResultCache, "dirFor").mockReturnValue(dir);
    try {
      await featureGateDataset.write(dir, [row(0, 100), row(2, 300), row(3, 200), { ...row(0, 400), symbol: "BBB" }]);
      const result = await featureGate.dataset.queryRows({ hash: HASH, metric: "missScore", operator: "gte", value: 2, pageSize: 1, page: 2 });
      expect(result.total).toBe(2);
      expect(result.symbols).toEqual(["AAA", "BBB"]);
      expect(result.rows.map((r) => r.t)).toEqual([300]);
      const legacy = await featureGate.dataset.queryRows({ hash: HASH, symbol: "AAA", minMissScore: 3 });
      expect(legacy.rows.map((r) => r.missScore)).toEqual([3]);
    } finally {
      cache.mockRestore();
      await fs.remove(dir);
    }
  });
});
