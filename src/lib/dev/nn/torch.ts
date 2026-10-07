import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";

import featureGate from "@/lib/dev/feature-gate";
import jsonFile from "@/lib/system/storage/json-file";
import v3 from "@/lib/strategies/default_with_features_gate/features/v3";
import type { DenseLayer, NeuralGateArtifact } from "@/lib/strategies/default_with_features_gate/features/v3";
import inputs from "@/lib/strategies/default_with_features_gate/features/v3/inputs";
import network from "@/lib/strategies/default_with_features_gate/features/v3/network";
import hardRules from "@/lib/strategies/default_with_features_gate/features/v3/hard-rules";
import type { NeuralHardRule } from "@/lib/strategies/default_with_features_gate/features/v3/hard-rules";
import cutoff from "@/lib/strategies/default_with_features_gate/features/v3/cutoff";

import assessment from "./assessment";
import dataset from "./dataset";
import calibration from "./torch-calibration";
import type run from "./run";

interface TorchOptions {
  python: string;
  activation: "relu" | "tanh";
  dropout: number;
  learningTarget: 1 | 2 | 3;
  hardRules?: NeuralHardRule[];
  objective?: "binary" | "ordinal";
  /** Fit/normalize only rows eligible for the fixed hard policy; outcome audits still include all rows. */
  fitEligible?: boolean;
  calibration?: "global" | "side-level" | "hierarchical";
}
interface Member { seed: number; epoch: number; risk: number[]; layers: DenseLayer[] }
interface WorkerResult { torch: string; numpy: string; folds: Array<{ symbol: string; members: Member[] }> }

/** Streams worker progress to the persistent logger and terminates it when the training task is aborted. */
async function execute(python: string, input: string, output: string, log: (message: string) => void, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(python, [path.resolve("src/lib/dev/nn/torch-worker.py"), input, output], { signal, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = createInterface({ input: child.stdout });
    const stderr = createInterface({ input: child.stderr });
    stdout.on("line", log);
    stderr.on("line", (line) => log(`TORCH STDERR ${line}`));
    child.once("error", reject);
    child.once("close", (code) => {
      stdout.close(); stderr.close();
      if (code === 0) resolve();
      else reject(new Error(`Torch training exited with code ${code}; inspect training.log. Python needs numpy and torch.`));
    });
  });
}

/** Validates worker predictions and averages seed scores in the portable runtime's order. */
function mean(members: Member[], count: number): number[] {
  if (!members.length || members.some((m) => m.risk.length !== count || m.risk.some((r) => !Number.isFinite(r) || r < 0 || r > 1))) {
    throw new Error("Torch returned malformed predictions.");
  }
  return Array.from({ length: count }, (_, i) => members.reduce((sum, m) => sum + m.risk[i], 0) / members.length);
}

/** Trains one ensemble family with leave-one-training-coin-out calibration, freezes it, and optionally tests once. */
async function train(params: Parameters<typeof run>[0] & { torch: TorchOptions; snapshotDir?: string }) {
  const { log, options } = params;
  if (params.trainHash === params.testHash) throw new Error("Train and test hashes must differ.");
  if (options.seeds.length > 16 || !options.seeds.length) throw new Error("Torch ensembles need 1–16 seeds.");
  if (!Number.isFinite(params.torch.dropout) || params.torch.dropout < 0 || params.torch.dropout >= 1 ||
      ![1, 2, 3].includes(params.torch.learningTarget) || !["tanh", "relu"].includes(params.torch.activation) ||
      (params.torch.objective !== undefined && !["binary", "ordinal"].includes(params.torch.objective)) ||
      (params.torch.calibration !== undefined && !["global", "side-level", "hierarchical"].includes(params.torch.calibration)) ||
      params.torch.hardRules?.some((rule) => !hardRules.names.includes(rule))) throw new Error("Invalid Torch training settings.");
  log(`TRAIN backend=torch dataset=${params.trainHash}; test=${params.testHash ?? "disabled"}`);
  log(`CONFIG ${JSON.stringify({ ...options, ...params.torch })}`);
  const bySymbol = await featureGate.dataset.readRows(params.trainHash);
  const rows = Object.values(bySymbol).flat();
  const fingerprint = createHash("sha256").update(JSON.stringify(bySymbol)).digest("hex");
  const prepared = dataset.prepare(rows, ["BTC"], options.profile);
  const samples = prepared.samples;
  const eligible = samples.map((sample) => hardRules.rejection(params.torch.hardRules ?? [], sample.t,
    sample.row.feature, { ...sample.row.sequences[0], symbol: sample.row.symbol }) === undefined);
  const symbols = [...new Set(samples.map((s) => s.row.symbol))].sort();
  if (symbols.length < 3) throw new Error("Torch cross-coin calibration requires at least three training coins.");
  const index = new Map(samples.map((s, i) => [s, i]));
  const folds = [...symbols, "ALL"].map((symbol) => {
    const training = samples.filter((s, i) => (symbol === "ALL" || s.row.symbol !== symbol) && (!params.torch.fitEligible || eligible[i]));
    const split = dataset.split(training, options.validationFraction, options.gapMs);
    const normalization = inputs.fit(split.fit.map((s) => s.raw), options.profile);
    return { symbol, split, normalization,
      fit: split.fit.map((s) => index.get(s)!), validation: split.validation.map((s) => index.get(s)!),
      calibration: training.map((s) => index.get(s)!), holdout: samples.flatMap((s, i) => s.row.symbol === symbol ? [i] : []),
    };
  });
  const inputPath = path.join(params.runDir, "torch-input.json");
  const outputPath = path.join(params.runDir, "torch-output.json");
  await jsonFile.write.atomic(inputPath, { options: { ...options, ...params.torch }, eligible, scores: samples.map((s) => s.score), raw: samples.map((s) => s.raw),
    folds: folds.map(({ split: _split, ...fold }) => fold) });
  log(`DATA usable=${samples.length} coins=${symbols.join(",")} fingerprint=${fingerprint}; no test rows supplied to worker`);
  await execute(params.torch.python, inputPath, outputPath, log, params.signal);
  const result = JSON.parse(await readFile(outputPath, "utf8")) as WorkerResult;
  if (!Array.isArray(result.folds) || result.folds.length !== folds.length) throw new Error("Torch returned malformed folds.");
  let fullRisk: number[] = [];
  let members: Member[] = [];
  const riskFolds = [];
  for (const [i, fold] of folds.entries()) {
    const output = result.folds[i];
    if (output.symbol !== fold.symbol || output.members.length !== options.seeds.length ||
        output.members.some((m, j) => m.seed !== options.seeds[j])) throw new Error("Torch returned unexpected ensemble members.");
    const risk = mean(output.members, samples.length);
    riskFolds.push({ symbol: fold.symbol, calibration: fold.calibration, holdout: fold.holdout, risk });
    if (fold.symbol === "ALL") { fullRisk = risk; members = output.members; }
  }
  const selection = calibration.select(samples, eligible, riskFolds, params.torch.calibration === "hierarchical" ? "hierarchical" : params.torch.calibration === "side-level");
  log(`SELECTION ${JSON.stringify(selection)}; calibrated only against training coins`);
  if (Object.values(selection.counts).some((count) => !count)) throw new Error("Training calibration left a coin with no acceptance; no model published.");
  const full = folds.at(-1)!;
  const artifact: NeuralGateArtifact = { v: 1, target: "missScore>=3", inputProfile: options.profile,
    features: [...inputs.namesFor(options.profile)], activation: params.torch.activation, normalization: full.normalization,
    layers: members[0].layers, ensemble: members.slice(1).map((m) => m.layers), threshold: selection.threshold,
    hardRules: params.torch.hardRules, cutoffs: selection.cutoffs, cutoffProfile: selection.cutoffProfile,
    training: { hash: params.trainHash, fingerprint, t: Date.now(), seed: members[0].seed, epoch: members[0].epoch,
      splitT: full.split.splitT, gapMs: options.gapMs, fitRows: full.fit.length, validationRows: full.validation.length,
      purgedRows: full.split.purged, excludedSymbols: ["BTC"], validationAccepted: 0, validationWorstScore: 0,
      cutoffMargin: selection.margin, learningTarget: params.torch.objective === "ordinal" ? 3 : params.torch.learningTarget,
      objective: params.torch.objective, backend: "torch", seeds: members.map((m) => m.seed), epochs: members.map((m) => m.epoch) },
  };
  const session = v3.create(artifact);
  let trainMetrics;
  let validation;
  try {
    // Use the production inference implementation for both outcome audits and float32 export parity.
    trainMetrics = featureGate.metrics.scoreRows(session.gate, rows);
    validation = featureGate.metrics.scoreRows(session.gate, full.split.validation.map((s) => s.row));
    for (const [i, sample] of samples.entries()) {
      const portable = network.mean([artifact.layers, ...(artifact.ensemble ?? [])], inputs.encode(sample.raw, full.normalization), artifact.activation);
      if (Math.abs(portable - fullRisk[i]) > 0.00001) throw new Error("Torch/portable-runtime numerical parity failed; no model published.");
      const threshold = cutoff.resolve(artifact.threshold, artifact.cutoffs, sample.row.sequences[0], sample.row.feature, artifact.cutoffProfile).threshold;
      const expected = fullRisk[i] < threshold && eligible[i];
      if (session.gate(sample.t, sample.row.feature, { ...sample.row.sequences[0], symbol: sample.row.symbol }).allow !== expected) {
        throw new Error("Torch/portable-runtime acceptance parity failed; no model published.");
      }
    }
  } finally { session.dispose(); }
  if (!trainMetrics.accepted || !validation.accepted || (trainMetrics.acceptedScoreDistribution.worstScore ?? Infinity) >= 3) throw new Error("Torch runtime training audit failed; no model published.");
  artifact.training.validationAccepted = validation.accepted;
  artifact.training.validationWorstScore = validation.acceptedScoreDistribution.worstScore!;
  const frozenPath = path.join(params.runDir, "model.json");
  await jsonFile.write.atomic(frozenPath, artifact);
  const modelHash = createHash("sha256").update(await readFile(frozenPath)).digest("hex");
  log(`FROZEN modelSHA256=${modelHash} candidate=${frozenPath}`);
  log(`TRAIN AUDIT accepted=${trainMetrics.accepted}/${trainMetrics.total}; distribution=${JSON.stringify(trainMetrics.acceptedScoreDistribution)}`);
  params.signal?.throwIfAborted();
  const test = params.testHash ? await assessment.run(params.testHash, frozenPath, log, 300, params.snapshotDir) : undefined;
  const status = test?.status ?? "not-tested";
  if (status !== "failed") { await jsonFile.write.atomic(params.modelPath, artifact); log(`EXPORT ${params.modelPath}`); }
  else log("FINAL TEST failed; candidate retained in research folder; active model not replaced");
  const report = { status, modelHash, trainHash: params.trainHash, testHash: params.testHash, fingerprint, options: { ...options, ...params.torch },
    versions: { torch: result.torch, numpy: result.numpy }, selection, trainMetrics, validation,
    testMetrics: test?.metrics, testFingerprint: test?.fingerprint, testMinAccepted: test?.minAccepted };
  await jsonFile.write.atomic(path.join(params.runDir, "report.json"), report);
  log(`REPORT ${path.join(params.runDir, "report.json")}; outcome=${status}`);
  return report;
}

const torch = { run: train } as const;
export default torch;
