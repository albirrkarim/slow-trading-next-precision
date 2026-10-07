import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import featureGateDataset, {
  type FeatureGateDatasetRow,
} from "@/lib/dev/backtestPrecision/feature-gate-dataset";
import type { RuntimeContext } from "@/lib/precision/types";
import type { RuntimeFeatures } from "@/lib/features/types";
import type { VolatilityPoint } from "@/lib/system/types";
import featureGate from "@/lib/dev/feature-gate";
import gateV2 from "@/lib/strategies/default_with_features_gate/features/v2/feature_gate_v2";

const point = (
  id: string,
  l: "B" | "T",
  lvl: number,
  t: number,
): VolatilityPoint => ({
  id,
  l,
  lvl,
  p: 100,
  pct: 5,
  t,
  vb: 0,
  vq: 0,
});

const runtimeFeatures = (): RuntimeFeatures => ({
  coins: {
    AAA: {
      latestVpoint: point("B_0", "B", 0, 10),
      priceNormalized: { current: 0.5, history: [] },
    },
    BTC: { priceNormalized: { current: 0.4, history: [] } },
    OTHER: { priceNormalized: { current: 0.9, history: [] } },
  },
  shared: {},
});

const contextAt = (t: number): RuntimeContext =>
  ({
    state: { currentTime: t, features: runtimeFeatures() },
  }) as RuntimeContext;

// BTEST:FEATURE_GATE_DATASET — every vPoint opens a pending row that closes
// on the first opposite-label point, scoring missed same-label entries.
describe("feature-gate dataset collector", () => {
  it("resolves B,B,B,T into missScores 2,1,0 with grown sequences", () => {
    const collector = featureGateDataset.collector.create();
    const context = contextAt(1000);

    collector.onVPoint(context, "AAA", point("B_0", "B", 0, 10));
    collector.captureFeatures(context);

    collector.onVPoint(context, "AAA", point("B_1", "B", -1, 11));
    collector.onVPoint(context, "AAA", point("B_2", "B", -2, 12));
    collector.onVPoint(context, "AAA", point("T_3", "T", 0, 13));

    const rows = collector.rows();
    const resolved = rows.filter((row) => row.resolved);
    const pending = rows.filter((row) => !row.resolved);

    expect(resolved).toHaveLength(3);
    expect(pending).toHaveLength(1);
    expect(pending[0].sequences.map((p) => p.id)).toEqual(["T_3"]);

    // B₀ → B₋₁ → B₋₂ → T: the three bottoms score 2, 1, 0 and all close on T.
    expect(resolved.map((row) => row.missScore)).toEqual([2, 1, 0]);
    expect(resolved.map((row) => row.sequences.map((p) => p.id))).toEqual([
      ["B_0", "B_1", "B_2", "T_3"],
      ["B_1", "B_2", "T_3"],
      ["B_2", "T_3"],
    ]);
    expect(resolved.map((row) => row.symbol)).toEqual(["AAA", "AAA", "AAA"]);
  });

  it("captures the pruned feature store once and never overwrites it", () => {
    const collector = featureGateDataset.collector.create();

    collector.onVPoint(contextAt(1000), "AAA", point("B_0", "B", 0, 10));
    collector.captureFeatures(contextAt(1000));

    // Reversal resolves the row before the next capture pass — a later pass
    // must not stamp or replace the first snapshot.
    collector.onVPoint(contextAt(2000), "AAA", point("T_1", "T", 0, 20));
    collector.captureFeatures(contextAt(2000));

    const [resolved, pending] = collector.rows();
    expect(resolved.resolved).toBe(true);
    expect(resolved.t).toBe(1000);
    // pruned like a position snapshot: BTC anchor + own coin, nothing else.
    expect(Object.keys(resolved.feature?.coins ?? {}).sort()).toEqual([
      "AAA",
      "BTC",
    ]);
    expect(resolved.feature?.coins.AAA?.priceNormalized?.current).toBe(0.5);
    expect(resolved.feature?.coins.OTHER).toBeUndefined();

    // The reversal-opened row captured on the next pass, unresolved.
    expect(pending.t).toBe(2000);
    expect(pending.sequences.map((p) => p.id)).toEqual(["T_1"]);
  });

  it("freezes the starting signal at capture and replays the same V2 refusal", () => {
    const now = Date.UTC(2025, 10, 15, 12);
    const signal = { ...point("B_0", "B", 0, now - 3_600_000), p: 114, maxUpPct: 0 };
    const context = contextAt(now);
    context.state.features = {
      shared: {},
      coins: {
        AAA: {
          latestVpoint: signal,
          priceNormalized: { current: 0.5, history: [{ t: now, p: 0.5 }] },
          vwap: { price: 100, stdev: 10, stretchPct: 20 },
        },
        BTC: {
          priceNormalized: { current: 0.5, history: [{ t: now, p: 0.05 }] },
          vwap: { stretchPct: 12 },
        },
      },
    };
    const collector = featureGateDataset.collector.create();
    collector.onVPoint(context, "AAA", signal);
    signal.maxUpPct = 4;
    collector.captureFeatures(context);
    const expected = gateV2(now, context.state.features, { ...signal, symbol: "AAA" });
    signal.maxUpPct = 8;
    collector.captureFeatures(contextAt(now + 60_000));
    collector.onVPoint(context, "AAA", point("T_1", "T", 0, now + 60_000));
    const captured = collector.rows()[0];
    expect(captured.sequences[0].maxUpPct).toBe(4);
    expect(captured.sequences[0].symbol).toBe("AAA");
    expect(captured.t).toBe(now);
    expect(expected).toMatch(/rebound already spent/);
    const report = featureGate.metrics.scoreRows(gateV2, [captured]);
    expect(report.accepted).toBe(0);
    expect(report.topRejections[0].reason).toBe(expected);
  });

  it("keeps each starting signal when several points precede capture", () => {
    const collector = featureGateDataset.collector.create();
    const first = { ...point("B_0", "B", 0, 10), maxUpPct: 0 };
    const next = { ...point("B_1", "B", -1, 11), maxUpPct: 0 };
    const context = contextAt(1000);
    context.state.features!.coins.AAA.latestVpoint = next;
    collector.onVPoint(context, "AAA", first);
    collector.onVPoint(context, "AAA", next);
    first.maxUpPct = 2;
    next.maxUpPct = 3;
    collector.captureFeatures(context);
    expect(collector.rows().map((row) => row.sequences[0])).toMatchObject([
      { id: "B_0", symbol: "AAA", maxUpPct: 2 },
      { id: "B_1", symbol: "AAA", maxUpPct: 3 },
    ]);
  });

  it("drops a row that reversed before any entry capture — nothing to replay", () => {
    const collector = featureGateDataset.collector.create();
    const context = contextAt(1000);
    collector.onVPoint(context, "AAA", point("B_0", "B", 0, 10));
    collector.onVPoint(context, "AAA", point("T_1", "T", 0, 20));
    collector.captureFeatures(context);
    // The B_0 row resolved inside the capture gap, T_1's own row is still
    // pending — neither is evaluable, so nothing is persisted.
    expect(collector.flush()).toHaveLength(0);
  });

  it("drops still-pending rows at flush — unresolved rows are noise", () => {
    const collector = featureGateDataset.collector.create();
    const context = contextAt(1000);

    collector.onVPoint(context, "AAA", point("B_0", "B", 0, 10));
    collector.onVPoint(context, "AAA", point("B_1", "B", -1, 11));
    collector.captureFeatures(context);

    const rows = collector.flush();
    expect(rows).toHaveLength(0);
    expect(collector.rows()).toHaveLength(0);
  });
});

describe("feature-gate dataset write", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "feature-gate-dataset-"));
  });

  afterEach(async () => {
    await fs.remove(dir);
  });

  it("writes one compact JSON array per symbol under dataset/", async () => {
    const collector = featureGateDataset.collector.create();
    const context = contextAt(1000);

    collector.onVPoint(context, "AAA", point("B_0", "B", 0, 10));
    collector.onVPoint(context, "BBB", point("T_0", "T", 0, 10));
    collector.captureFeatures(context);
    collector.onVPoint(context, "AAA", point("T_1", "T", 0, 20));
    collector.onVPoint(context, "BBB", point("B_1", "B", 0, 15));

    await featureGateDataset.write(dir, collector.flush());

    const datasetDir = featureGateDataset.datasetDir(dir);
    expect((await fs.readdir(datasetDir)).sort()).toEqual([
      "AAA.json",
      "BBB.json",
    ]);

    const aaa = (await fs.readJson(
      path.join(datasetDir, "AAA.json"),
    )) as FeatureGateDatasetRow[];
    // B_0 resolved by T_1 (score 0); T_1's own row stays pending and is
    // dropped at flush.
    expect(aaa).toHaveLength(1);
    expect(aaa[0].resolved).toBe(true);
    expect(aaa[0].missScore).toBe(0);
    expect(aaa[0].sequences.map((p) => p.id)).toEqual(["B_0", "T_1"]);

    const bbb = (await fs.readJson(
      path.join(datasetDir, "BBB.json"),
    )) as FeatureGateDatasetRow[];
    expect(bbb).toHaveLength(1);
    expect(bbb[0].resolved).toBe(true);
    expect(bbb[0].missScore).toBe(0);

    // Compact output — single-line JSON (trailing EOL aside).
    const raw = await fs.readFile(path.join(datasetDir, "AAA.json"), "utf8");
    expect(raw.trim()).not.toContain("\n");
    expect(JSON.parse(raw)).toHaveLength(1);
  });
});
