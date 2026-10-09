import { afterEach, describe, expect, it, vi } from "vitest";

import type { FeatureGateDatasetRow } from "@/lib/dev/backtestPrecision/feature-gate-dataset";
import featureGate from "@/lib/dev/feature-gate";
import clientFeatureGate from "@/lib/dev/feature-gate/client";
import type { RuntimeFeatures } from "@/lib/features/types";
import type { VolatilityPoint } from "@/lib/system/types";
import gateDefault from "@/lib/strategies/default_with_features_gate/features";
import defaultStrategy from "@/lib/strategies/default_with_features_gate";
import {
  FEATURE_GATE_REGISTRY,
  type FeatureGate,
} from "@/lib/strategies/feature-gates";

const MISSING_HASH = "0".repeat(64);

const point = (id: string, l: "B" | "T"): VolatilityPoint =>
  ({ id, l, lvl: 0, p: 100, pct: 5, t: 1, vb: 0, vq: 0 }) as VolatilityPoint;

const featuresWith = (
  symbol: string,
  current?: number,
): RuntimeFeatures | undefined =>
  current === undefined
    ? { coins: {}, shared: {} }
    : {
        coins: {
          [symbol]: {
            priceNormalized: { current, history: [] },
          },
        },
        shared: {},
      };

const row = (
  partial: Partial<FeatureGateDatasetRow> & { symbol: string },
): FeatureGateDatasetRow => ({
  t: 1000,
  resolved: true,
  sequences: [point("B_0", "B")],
  ...partial,
});

/** Rule stub: rejects rows below a normalized threshold or without a coin. */
const stubGate: FeatureGate = (_currentTime, features, signal) => {
  const current =
    features?.coins[signal.symbol ?? ""]?.priceNormalized?.current;
  if (current === undefined) return { allow: false, message: "no coin feature" };
  return { allow: current >= 0.5, message: current >= 0.5 ? "normalized threshold passed" : "low normalized" };
};

// Feature-gate evaluation metrics — docs/STRATEGY/FEATURE_EXTRACTION.md.
describe("feature-gate evaluate", () => {
  afterEach(() => vi.restoreAllMocks());

  it("applies only selected v4 subgates and reports the effective selection", async () => {
    vi.spyOn(featureGate.dataset, "readRows").mockResolvedValue({
      AAA: [row({ feature: featuresWith("AAA", 0.5), missScore: 0, symbol: "AAA" })],
    });

    const defaultReport = await featureGate.evaluate({ hash: MISSING_HASH, slug: "v4" });
    const noneReport = await featureGate.evaluate({ hash: MISSING_HASH, slug: "v4", enabledSubGates: [] });
    const vwapReport = await featureGate.evaluate({ hash: MISSING_HASH, slug: "v4", enabledSubGates: ["vwap"] });

    expect(defaultReport.enabledSubGates).toEqual(Object.keys(FEATURE_GATE_REGISTRY.v4.subGates));
    expect(defaultReport.metrics.accepted).toBe(0);
    expect(noneReport.enabledSubGates).toEqual([]);
    expect(noneReport.metrics.accepted).toBe(1);
    expect(vwapReport.enabledSubGates).toEqual(["vwap"]);
    expect(vwapReport.metrics.accepted).toBe(0);
  });

  it("keeps the cloned v5 decisions equal to v4 while reporting v5 messages", async () => {
    vi.spyOn(featureGate.dataset, "readRows").mockResolvedValue({
      AAA: [row({ feature: featuresWith("AAA", 0.5), missScore: 0, symbol: "AAA" })],
    });

    const v4 = await featureGate.evaluate({ hash: MISSING_HASH, slug: "v4", enabledSubGates: [] });
    const v5 = await featureGate.evaluate({ hash: MISSING_HASH, slug: "v5", enabledSubGates: [] });
    expect(v5.enabledSubGates).toEqual([]);
    expect(v5.metrics).toEqual(v4.metrics);
    expect(v5.acceptedHighScoreRows).toEqual(v4.acceptedHighScoreRows);
    const signal = { ...point("B_0", "B"), symbol: "AAA" };
    expect(FEATURE_GATE_REGISTRY.v4.gate(1000, featuresWith("AAA", 0.5), signal, []).message).toMatch(/^v4:/);
    expect(FEATURE_GATE_REGISTRY.v5.gate(1000, featuresWith("AAA", 0.5), signal, []).message).toMatch(/^v5:/);

    const v5Default = await featureGate.evaluate({ hash: MISSING_HASH, slug: "v5" });
    expect(v5Default.enabledSubGates).toEqual(FEATURE_GATE_REGISTRY.v5.defaultSubGates);
    expect(v5Default.metrics.accepted).toBe(0);
  });

  it("keeps experimental v5 checks opt-in and explains their rejections", () => {
    const day = 24 * 60 * 60 * 1000;
    const btcValues = [0.1, 0.2, 0.15, 0.25, 0.2, 0.3, 0.3, 0.42];
    const history = (values: number[]) => values.map((p, index) => ({ p, t: index * day }));
    const signal = { ...point("B_0", "B"), symbol: "AAA" };
    const dislocated: RuntimeFeatures = { coins: {
      BTC: { priceNormalized: { current: 0.42, history: history(btcValues) } },
      AAA: { priceNormalized: { current: 0.28, history: history(btcValues.map((value) => 0.7 - value)) } },
    }, shared: {} };
    expect(FEATURE_GATE_REGISTRY.v5.gate(7 * day, dislocated, signal, []).allow).toBe(true);
    expect(FEATURE_GATE_REGISTRY.v5.gate(7 * day, dislocated, signal, ["btcDislocation"]))
      .toMatchObject({ allow: false, message: expect.stringContaining("BTC dislocation") });

    const coupled: RuntimeFeatures = { coins: {
      BTC: { priceNormalized: { current: 0.7, history: history([0.1, 0.3, 0.2, 0.5, 0.3, 0.6, 0.4, 0.7]) } },
      AAA: { priceNormalized: { current: 0.7, exhaustion: 0.1, history: history([0.1, 0.3, 0.2, 0.5, 0.3, 0.6, 0.4, 0.7]) } },
    }, shared: {} };
    expect(FEATURE_GATE_REGISTRY.v5.gate(7 * day, coupled, signal, ["coupledWithoutExhaustion"]))
      .toMatchObject({ allow: false, message: expect.stringContaining("coupled without exhaustion") });
  });

  it("routes v5 subgate selections through browser evaluation", async () => {
    const input = {
      rows: [row({ feature: featuresWith("AAA", 0.5), missScore: 0, symbol: "AAA" })],
      slug: "v5",
      modelUrl: "unused",
    };
    const selected = await clientFeatureGate.evaluate({ ...input, enabledSubGates: [] });
    const defaults = await clientFeatureGate.evaluate(input);
    expect(selected.metrics.accepted).toBe(1);
    expect(selected.decisions[0]?.message).toMatch(/^v5:/);
    expect(defaults.metrics.accepted).toBe(0);
  });

  it("rejects invalid subgate selections before loading the dataset", async () => {
    const readRows = vi.spyOn(featureGate.dataset, "readRows");
    for (const enabledSubGates of ["vwap", ["unknown"], ["vwap", "vwap"]]) {
      await expect(featureGate.evaluate({ hash: MISSING_HASH, slug: "v4", enabledSubGates }))
        .rejects.toThrow(/enabledSubGates/);
    }
    await expect(featureGate.evaluate({ hash: MISSING_HASH, slug: "v2", enabledSubGates: [] }))
      .rejects.toThrow(/only supported for gates with selectable checks/);
    expect(readRows).not.toHaveBeenCalled();
  });

  it("uses allow explicitly and groups scientific-notation rejection values", () => {
    const messages = ["allowed even with a message", "v3 NN: risk 1e-7 >= cutoff 1e-8", "v3 NN: risk 0.1 >= cutoff 0.001"];
    let index = 0;
    const gate: FeatureGate = () => ({ allow: index === 0, message: messages[index++] });
    const report = featureGate.metrics.scoreRows(gate, Array.from({ length: 3 }, () => row({
      symbol: "AAA", feature: featuresWith("AAA", 0.5), missScore: 0,
    })));
    expect(report.accepted).toBe(1);
    expect(report.rejected).toBe(2);
    expect(report.topRejections).toEqual([{ count: 2, reason: "v# NN: risk # >= cutoff #", sample: messages[1] }]);
  });

  it("computes every documented metric with unresolved rows excluded from scores", () => {
    const rows: FeatureGateDatasetRow[] = [
      // accepted score-0
      row({ feature: featuresWith("AAA", 0.6), missScore: 0, symbol: "AAA" }),
      // rejected score-0
      row({ feature: featuresWith("AAA", 0.4), missScore: 0, symbol: "AAA" }),
      // rejected score>0
      row({ feature: featuresWith("AAA", 0.4), missScore: 1, symbol: "AAA" }),
      // accepted score 2 and 4
      row({ feature: featuresWith("AAA", 0.7), missScore: 2, symbol: "AAA" }),
      row({ feature: featuresWith("AAA", 0.7), missScore: 4, symbol: "AAA" }),
      // unresolved — counts in total/acceptanceRate only
      row({
        feature: featuresWith("AAA", 0.7),
        resolved: false,
        symbol: "AAA",
      }),
      // no coin feature on another symbol — rejected
      row({
        feature: featuresWith("BBB", undefined),
        missScore: 0,
        symbol: "BBB",
      }),
    ];

    const report = featureGate.metrics.scoreRows(stubGate, rows);

    expect(report.total).toBe(7);
    expect(report.resolved).toBe(6);
    expect(report.accepted).toBe(4);
    expect(report.rejected).toBe(3);
    expect(report.acceptanceRate).toBeCloseTo(4 / 7);

    // accepted score-0 / accepted resolved = 1/3
    expect(report.acceptedQuality).toBeCloseTo(1 / 3);
    // accepted score-0 / all score-0 (rows 1, 2, 7) = 1/3
    expect(report.goodRetained).toBeCloseTo(1 / 3);
    // rejected score>0 / all score>0 (rows 3, 4, 5) = 1/3
    expect(report.badBlocked).toBeCloseTo(1 / 3);

    expect(report.acceptedScoreDistribution).toEqual({
      "0": 1,
      "2": 1,
      "4": 1,
      avgScore: 2,
      worstScore: 4,
    });

    expect(report.bySymbol).toEqual({
      AAA: { accepted: 4, resolved: 5, total: 6 },
      BBB: { accepted: 0, resolved: 1, total: 1 },
    });

    expect(report.topRejections).toEqual([
      { count: 2, reason: "low normalized", sample: "low normalized" },
      { count: 1, reason: "no coin feature", sample: "no coin feature" },
    ]);
  });

  it("excludes uncaptured and invalid resolved rows before calling the gate", () => {
    let calls = 0;
    const gate: FeatureGate = () => { calls += 1; return { allow: true, message: "allowed" }; };
    const report = featureGate.metrics.scoreRows(gate, [
      row({ symbol: "AAA", t: undefined, missScore: 0 }),
      row({ symbol: "AAA", t: Number.NaN, feature: featuresWith("AAA", 0.6), missScore: 0 }),
      row({ symbol: "AAA", feature: featuresWith("AAA", 0.6) }),
      row({ symbol: "AAA", feature: featuresWith("AAA", 0.6), missScore: 0 }),
    ]);
    expect(calls).toBe(1);
    expect(report.skipped).toBe(3);
    expect(report.total).toBe(1);
    expect(report.resolved).toBe(1);
    expect(report.acceptedQuality).toBe(1);
  });

  it("leaves ratio metrics undefined on empty denominators", () => {
    const report = featureGate.metrics.scoreRows(stubGate, []);
    expect(report.total).toBe(0);
    expect(report.acceptanceRate).toBe(0);
    expect(report.acceptedQuality).toBeUndefined();
    expect(report.goodRetained).toBeUndefined();
    expect(report.badBlocked).toBeUndefined();
    expect(report.acceptedScoreDistribution.avgScore).toBeUndefined();
    expect(report.acceptedScoreDistribution.worstScore).toBeUndefined();
  });

  it("rejects unknown slugs and missing datasets with clear errors", async () => {
    await expect(
      featureGate.evaluate({ hash: MISSING_HASH, slug: "nope" }),
    ).rejects.toThrow(/Unknown feature gate slug/);

    await expect(
      featureGate.evaluate({ hash: MISSING_HASH, slug: "v1" }),
    ).rejects.toThrow(/no dataset.*also produce dataset/i);
  });
});

describe("feature-gate registry", () => {
  it("lists every gate version and wires the strategy gate session", () => {
    expect(featureGate.list()).toEqual([
      {
        label: FEATURE_GATE_REGISTRY.streak_v1.label,
        slug: "streak_v1",
      },
      { label: FEATURE_GATE_REGISTRY.v1.label, slug: "v1" },
      { label: FEATURE_GATE_REGISTRY.v2.label, slug: "v2" },
      { label: FEATURE_GATE_REGISTRY.v3.label, slug: "v3" },
      { label: FEATURE_GATE_REGISTRY.v4.label, slug: "v4", subGates: FEATURE_GATE_REGISTRY.v4.subGates },
      { label: FEATURE_GATE_REGISTRY.v5.label, slug: "v5", subGates: FEATURE_GATE_REGISTRY.v5.subGates,
        defaultSubGates: [...FEATURE_GATE_REGISTRY.v5.defaultSubGates] },
    ]);
    expect(defaultStrategy.warmup).toBe(gateDefault.warmup);
    expect(defaultStrategy.dispose).toBe(gateDefault.dispose);
    expect(FEATURE_GATE_REGISTRY.v2.gate).toBeTypeOf("function");
    expect(FEATURE_GATE_REGISTRY.v4.gate).toBeTypeOf("function");
    expect(FEATURE_GATE_REGISTRY.v5.gate).toBeTypeOf("function");
  });
});
