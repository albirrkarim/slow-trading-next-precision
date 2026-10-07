import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import featureGate from "@/lib/dev/feature-gate";
import type { FeatureGateDatasetRow } from "@/lib/dev/feature-gate";
import nn from "@/lib/dev/nn";
import optimizer from "@/lib/dev/nn/optimizer";
import selection from "@/lib/dev/nn/selection";
import { DEFAULT_OPTIONS } from "@/lib/dev/nn/run";
import type { TrainingSample } from "@/lib/dev/nn/types";
import v3 from "@/lib/strategies/default_with_features_gate/features/v3";
import artifactFormat from "@/lib/strategies/default_with_features_gate/features/v3/artifact";
import inputs from "@/lib/strategies/default_with_features_gate/features/v3/inputs";
import network from "@/lib/strategies/default_with_features_gate/features/v3/network";
import type { NeuralGateArtifact } from "@/lib/strategies/default_with_features_gate/features/v3";
import { FEATURE_GATE_REGISTRY } from "@/lib/strategies/feature-gates";

const TRAIN_HASH = "a".repeat(64);
const TEST_HASH = "b".repeat(64);

const row = (index: number, score = index % 3 === 0 ? 3 : 0): FeatureGateDatasetRow => {
  const t = (index + 1) * 100;
  const start = { id: `B_${index}`, t: t - 1, lvl: 0, l: "B" as const, p: 100, pct: 5, vb: 0, vq: 0 };
  return { symbol: "AAA", t, resolved: true, missScore: score,
    sequences: [start, ...Array.from({ length: score }, (_, i) => ({ ...start, id: `follow_${index}_${i}`, t: t + i + 1, lvl: -i - 1 })), { ...start, id: `T_${index}`, l: "T", t: t + 80 }],
    feature: { shared: {}, coins: {
      AAA: { priceNormalized: { current: score >= 3 ? 0.9 : 0.1, history: [] } },
      BTC: { priceNormalized: { current: 0.5, history: [] } },
    } },
  };
};

const artifact = (): NeuralGateArtifact => ({
  v: 1, target: "missScore>=3", features: [...inputs.names],
  normalization: inputs.fit([inputs.read(row(0).t!, row(0).feature, { ...row(0).sequences[0], symbol: "AAA" })]),
  layers: [{ input: inputs.names.length * 2, output: 1, w: new Array<number>(inputs.names.length * 2).fill(0), b: [-2] }], threshold: 0.5,
  training: { hash: TRAIN_HASH, fingerprint: "f".repeat(64), t: 1, seed: 17, epoch: 1, splitT: 1, gapMs: 0, fitRows: 1, validationRows: 1, purgedRows: 0,
    excludedSymbols: ["BTC"], validationAccepted: 1, validationWorstScore: 0 },
});

afterEach(() => vi.restoreAllMocks());

// BTEST:FEATURE_NN — capture-only inputs, purged splits, constrained selection and owned inference sessions.
describe("NN inputs and validation", () => {
  it("excludes future history, future sequence outcomes and signal bookkeeping from model inputs", () => {
    const sample = row(1);
    const read = () => inputs.read(sample.t!, sample.feature, { ...sample.sequences[0], symbol: sample.symbol });
    const before = read();
    sample.missScore = 99;
    sample.sequences.push({ ...sample.sequences[0], t: 999999, lvl: -99 });
    sample.sequences[0].usedBy = ["another-account"];
    sample.feature!.coins.AAA.priceNormalized.history.push({ t: 999999, p: 99 });
    sample.feature!.coins.AAA.latestVpoint = { ...sample.sequences[0], p: 99999 };
    expect(read()).toEqual(before);
  });

  it("fits scaling on training data only and keeps missing readings separate from real zero", () => {
    const a = new Array<number | undefined>(inputs.names.length).fill(undefined);
    const b = [...a]; a[0] = 1; b[0] = 3;
    const normalization = inputs.fit([a, b]);
    expect(normalization.mean[0]).toBe(2);
    expect(normalization.std[0]).toBe(1);
    const unseen = [...a]; unseen[0] = 99; unseen[1] = 0;
    const encoded = inputs.encode(unseen, normalization);
    expect(encoded[0]).toBe(8);
    expect(encoded[1]).toBe(0);
    expect(encoded[inputs.names.length + 1]).toBe(1);
    expect(encoded[inputs.names.length + 2]).toBe(0);
  });

  it("purges crossing labels and gives every coin the same chronological validation boundary", () => {
    const rows = Array.from({ length: 20 }, (_, index) => row(index));
    rows[0].sequences.at(-1)!.t = 99999;
    const prepared = nn.dataset.prepare(rows);
    const split = nn.dataset.split(prepared.samples, 0.2, 0);
    expect(split.validation).toHaveLength(4);
    expect(split.validation.every((sample) => sample.t >= split.splitT)).toBe(true);
    expect(split.fit.every((sample) => sample.t < split.splitT && sample.labelT! < split.splitT)).toBe(true);
    expect(split.fit.some((sample) => sample.row === rows[0])).toBe(false);
    expect(split.purged).toBeGreaterThan(0);
  });

  it("rejects ties with unsafe predictions and never treats empty acceptance as success", () => {
    const samples = [0, 2, 3, 4].map((score) => ({ score }) as TrainingSample);
    const predictions = [0.1, 0.2, 0.2, 0.8];
    const threshold = selection.cutoff([{ samples, predictions }]);
    expect(threshold).toBe(0.2);
    expect(selection.summarize(samples, predictions, threshold)).toMatchObject({ accepted: 1, violations: 0, worstScore: 0 });
    const empty = selection.summarize(samples, predictions, 0);
    expect(empty.worstScore).toBeUndefined();
    expect(selection.better({ fit: empty, validation: empty } as never, undefined)).toBe(false);
  });
});

describe("NN learning math", () => {
  it("matches backpropagation to an independent finite-difference gradient", () => {
    const layers = optimizer.initialize([2, 3, 1], optimizer.random(17));
    const gradient = optimizer.zeros(layers);
    optimizer.accumulate(layers, gradient, [0.2, -0.4], 1, 2);
    for (const l of [0, 1]) for (const key of ["w", "b"] as const) {
      const old = layers[l][key][0];
      const eps = 1e-6;
      layers[l][key][0] = old + eps;
      const upper = optimizer.loss([network.predict(layers, [0.2, -0.4])], [1], 2);
      layers[l][key][0] = old - eps;
      const lower = optimizer.loss([network.predict(layers, [0.2, -0.4])], [1], 2);
      layers[l][key][0] = old;
      expect(gradient[l][key][0]).toBeCloseTo((upper - lower) / (2 * eps), 5);
    }
  });

  it("learns a nonlinear XOR target with deterministic initialization and Adam updates", () => {
    const layers = optimizer.initialize([2, 4, 1], optimizer.random(17));
    expect(layers).toEqual(optimizer.initialize([2, 4, 1], optimizer.random(17)));
    const update = optimizer.adam(layers, 0.03, 0);
    const x = [[0, 0], [0, 1], [1, 0], [1, 1]];
    const y = [0, 1, 1, 0];
    for (let step = 0; step < 400; step++) {
      const gradient = optimizer.zeros(layers);
      x.forEach((input, index) => optimizer.accumulate(layers, gradient, input, y[index], 1));
      update(gradient, 4);
    }
    x.forEach((input, index) => expect(Math.abs(network.predict(layers, input) - y[index])).toBeLessThan(0.15));
  });
});

describe("v3 inference lifecycle", () => {
  it("validates artifacts and owns independent, disposable sessions", () => {
    const model = artifact();
    const first = v3.create(model);
    const second = v3.create(model);
    const sample = row(1);
    const signal = { ...sample.sequences[0], symbol: sample.symbol };
    expect(first.gate(sample.t!, sample.feature, signal)).toBeUndefined();
    first.dispose(); first.dispose();
    expect(() => first.gate(sample.t!, sample.feature, signal)).toThrow(/disposed/);
    expect(second.gate(sample.t!, sample.feature, signal)).toBeUndefined();
    expect(model.layers[0].b[0]).toBe(-2);
    second.dispose();
    const broken = artifact(); broken.layers[0].w.pop();
    expect(() => artifactFormat.validate(broken)).toThrow(/dense layer/);
    const wrongSchema = artifact(); wrongSchema.features.reverse();
    expect(() => artifactFormat.validate(wrongSchema)).toThrow(/features/);
  });

  it("prepares once and releases evaluation resources on success and errors", async () => {
    const dispose = vi.fn();
    const gate = vi.fn(() => undefined);
    const prepare = vi.spyOn(FEATURE_GATE_REGISTRY.v3, "prepare").mockResolvedValue({ gate, dispose });
    vi.spyOn(featureGate.dataset, "readRows").mockResolvedValue({ AAA: [row(1), row(2)] });
    await featureGate.evaluate({ hash: TRAIN_HASH, slug: "v3" });
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(gate).toHaveBeenCalledTimes(2);
    expect(dispose).toHaveBeenCalledTimes(1);
    gate.mockImplementation(() => { throw new Error("inference error"); });
    await expect(featureGate.evaluate({ hash: TRAIN_HASH, slug: "v3" })).rejects.toThrow("inference error");
    expect(dispose).toHaveBeenCalledTimes(2);
  });

  it("freezes and exports the model before reading the final test and reloads the saved artifact", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "feature-nn-"));
    const modelPath = path.join(dir, "weights.json");
    const messages: string[] = [];
    const read = vi.spyOn(featureGate.dataset, "readRows").mockImplementation(async (hash) => {
      if (hash === TEST_HASH) {
        expect(await fs.pathExists(modelPath)).toBe(true);
        expect(messages.some((message) => message.startsWith("FROZEN"))).toBe(true);
        return { AAA: [row(1), row(2)] };
      }
      return { AAA: Array.from({ length: 30 }, (_, index) => row(index)) };
    });
    try {
      const report = await nn.run({ trainHash: TRAIN_HASH, testHash: TEST_HASH, modelPath, runDir: dir,
        options: { ...DEFAULT_OPTIONS, epochs: 10, seeds: [17], hidden: [4], gapMs: 0, learningRate: 0.02 }, log: (message) => messages.push(message) });
      expect(read.mock.calls.map(([hash]) => hash)).toEqual([TRAIN_HASH, TEST_HASH]);
      expect(report.status).toBe("passed");
      expect(report.trainMetrics.acceptedScoreDistribution.worstScore).toBeLessThan(3);
      expect((await fs.readFile(modelPath, "utf8")).trim()).not.toContain("\n");
      expect(await fs.pathExists(path.join(dir, "report.json"))).toBe(true);
      const loaded = await v3.load(modelPath);
      expect(loaded.gate(row(1).t!, row(1).feature, { ...row(1).sequences[0], symbol: "AAA" })).toBeUndefined();
      loaded.dispose();
    } finally { await fs.remove(dir); }
  });
});
