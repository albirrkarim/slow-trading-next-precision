import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import featureGate from "@/lib/dev/feature-gate";
import jsonFile from "@/lib/system/storage/json-file";
import v3 from "@/lib/strategies/default_with_features_gate/features/v3";
import inputs from "@/lib/strategies/default_with_features_gate/features/v3/inputs";
import type { NeuralGateArtifact } from "@/lib/strategies/default_with_features_gate/features/v3";
import network from "@/lib/strategies/default_with_features_gate/features/v3/network";

import data from "./dataset";
import assessment from "./assessment";
import selection from "./selection";
import trainer from "./trainer";
import type { NeuralCandidate, NeuralTrainingOptions, RiskSummary, TrainingSample } from "./types";

export const DEFAULT_TRAIN_HASH = "c641dc191a3dcad0c5ed927ef80e99645c14a580637fdb602d1a0c49416e3b8f";
export const DEFAULT_TEST_HASH = "1f9966ef01ef820b553e0a583331506454fcf74bec3394f047df8d6e6ef0c438";
export const DEFAULT_MODEL_PATH = "src/lib/strategies/default_with_features_gate/features/v3/model.json";
export const DEFAULT_OPTIONS: NeuralTrainingOptions = {
  // Frozen from training-only cross-coin research, not adjusted against the test dataset.
  profile: "legacy", cutoffMargin: 0.2026439305243851,
  epochs: 180, batchSize: 64, learningRate: 0.003, l2: 0.001, hidden: [8], seeds: [17],
  validationFraction: 0.2, gapMs: 86_400_000, logEvery: 5, patience: 40,
};

/** Compact progress readout for the score-constrained acceptance objective. */
function summary(value: RiskSummary): string {
  return `${value.accepted}/${value.total} (${(value.accepted / value.total * 100).toFixed(1)}%) mean=${value.avgScore?.toFixed(3) ?? "n/a"} worst=${value.worstScore ?? "n/a"} score>=3=${value.violations}`;
}

/** Trains using one hash only; an optional final test is first read after weights and cutoff have been frozen. */
async function run(params: {
  trainHash: string;
  testHash?: string;
  modelPath: string;
  runDir: string;
  options: NeuralTrainingOptions;
  log: (message: string) => void;
  signal?: AbortSignal;
}) {
  const { log, options } = params;
  if (params.trainHash === params.testHash) throw new Error("Train and test hashes must differ.");
  log(`TRAIN dataset=${params.trainHash}; final test=${params.testHash ?? "disabled (use --test after tuning)"}`);
  log(`CONFIG ${JSON.stringify(options)}; target=missScore>=3; BTC is an input anchor only`);
  const bySymbol = await featureGate.dataset.readRows(params.trainHash);
  const rows = Object.values(bySymbol).flat();
  const fingerprint = createHash("sha256").update(JSON.stringify(bySymbol)).digest("hex");
  const prepared = data.prepare(rows, ["BTC"], options.profile);
  const split = data.split(prepared.samples, options.validationFraction, options.gapMs);
  const normalization = inputs.fit(split.fit.map((sample) => sample.raw), options.profile);
  const encode = (sample: typeof split.fit[number]): TrainingSample => ({ ...sample, x: inputs.encode(sample.raw, normalization) });
  const fit = split.fit.map(encode);
  const validation = split.validation.map(encode);
  const excludedFromFit = new Set([...split.fit, ...split.validation]);
  // Purged rows never enter fitting/scaling; their training-hash labels may tighten the cutoff only.
  const calibration = prepared.samples.filter((sample) => !excludedFromFit.has(sample)).map(encode);
  log(`DATA rows=${rows.length}; usable=${prepared.samples.length}; anchor rows=${prepared.anchors}; invalid/unresolved=${prepared.skipped}`);
  for (const [symbol, coinRows] of Object.entries(bySymbol)) {
    const histogram: Record<string, number> = {};
    for (const row of coinRows) histogram[String(row.missScore)] = (histogram[String(row.missScore)] ?? 0) + 1;
    log(`  ${symbol}: ${coinRows.length} rows; scores=${JSON.stringify(histogram)}`);
  }
  log(`SPLIT fit=${fit.length}, validation=${validation.length}, purged from fitting=${split.purged}; validation starts ${new Date(split.splitT).toISOString()}; gap=${options.gapMs / 3_600_000}h`);
  const names = inputs.namesFor(options.profile);
  log(`NORMALIZATION fitted on ${fit.length} fitting rows only; profile=${options.profile ?? "legacy"}; ${names.length} features + ${names.length} presence bits; hidden=${options.hidden.join("→") || "linear"}`);
  const unsafe = fit.filter((row) => row.score >= 3).length;
  log(`LABELS fit safe=${fit.length - unsafe}, unsafe=${unsafe}; unsafe loss weight=${Math.min(50, (fit.length - unsafe) / unsafe).toFixed(3)}`);
  log("SELECTION maximizes validation acceptance with zero accepted score>=3 across the entire training hash; no test inputs used");
  let best: NeuralCandidate | undefined;
  const candidates: Array<Omit<NeuralCandidate, "layers"> | { seed: number; qualified: false }> = [];
  for (const [index, seed] of options.seeds.entries()) {
    params.signal?.throwIfAborted();
    log(`MODEL ${index + 1}/${options.seeds.length} seed=${seed} — starting`);
    const started = Date.now();
    let lastEpoch = 0;
    const candidate = await trainer.fit(fit, validation, options, seed, (progress) => {
      lastEpoch = progress.epoch;
      if (progress.epoch === 1 || progress.epoch % options.logEvery === 0 || progress.improved) {
        const eta = (Date.now() - started) / progress.epoch * (options.epochs - progress.epoch) / 1000;
        log(`EPOCH seed=${seed} ${progress.epoch}/${options.epochs} loss=${progress.fitLoss.toFixed(5)} valLoss=${progress.validationLoss.toFixed(5)} cutoff=${progress.threshold.toPrecision(6)} fitSafe=${summary(progress.fit)} valSafe=${summary(progress.validation)} ETA<=${eta.toFixed(0)}s${progress.improved ? " BEST CHECKPOINT" : ""}`);
      }
    }, params.signal, calibration);
    if (!candidate) {
      candidates.push({ seed, qualified: false });
      log(`MODEL seed=${seed} ended at epoch=${lastEpoch}; no nonempty qualifying validation acceptance`);
      continue;
    }
    const { layers: _layers, ...record } = candidate;
    candidates.push(record);
    log(`MODEL seed=${seed} ended at epoch=${lastEpoch}; selected epoch=${candidate.epoch}; validation=${summary(candidate.validation)}`);
    if (selection.better(candidate, best)) best = candidate;
  }
  if (!best) {
    await jsonFile.write.atomic(path.join(params.runDir, "report.json"), { status: "no-qualifying-model", trainHash: params.trainHash, fingerprint, options, candidates });
    throw new Error("No model accepted a validation row while keeping scores below 3. No artifact published; inspect training.log/report.json.");
  }
  const margin = options.cutoffMargin ?? 1;
  if (!Number.isFinite(margin) || margin <= 0 || margin > 1) throw new Error("Cutoff margin must be in (0, 1].");
  const baselineCutoff = best.threshold;
  best.threshold *= margin;
  best.fit = selection.summarize(fit, fit.map((row) => network.predict(best.layers, row.x)), best.threshold);
  best.validation = selection.summarize(validation, validation.map((row) => network.predict(best.layers, row.x)), best.threshold);
  log(`MARGIN multiplier=${margin} baselineCutoff=${baselineCutoff} effectiveCutoff=${best.threshold}; fit=${summary(best.fit)} validation=${summary(best.validation)}`);
  if (!best.fit.accepted || !best.validation.accepted) throw new Error("Safety margin left empty fitting or validation acceptance. No artifact published.");
  const artifact: NeuralGateArtifact = {
    v: 1, target: "missScore>=3", inputProfile: options.profile ?? "legacy", features: [...names], normalization, layers: best.layers, threshold: best.threshold,
    training: { hash: params.trainHash, fingerprint, t: Date.now(), seed: best.seed, epoch: best.epoch, splitT: split.splitT, gapMs: options.gapMs,
      fitRows: fit.length, validationRows: validation.length, purgedRows: split.purged, excludedSymbols: ["BTC"],
      validationAccepted: best.validation.accepted, validationWorstScore: best.validation.worstScore!, cutoffMargin: margin },
  };
  const session = v3.create(artifact);
  let trainMetrics;
  try { trainMetrics = featureGate.metrics.scoreRows(session.gate, rows); } finally { session.dispose(); }
  if (!trainMetrics.accepted || (trainMetrics.acceptedScoreDistribution.worstScore ?? Infinity) >= 3) {
    throw new Error("Export audit failed: runtime inference did not preserve training score constraints.");
  }
  await jsonFile.write.atomic(path.join(params.runDir, "model.json"), artifact);
  await jsonFile.write.atomic(params.modelPath, artifact);
  const modelHash = createHash("sha256").update(await readFile(params.modelPath)).digest("hex");
  log(`FROZEN seed=${best.seed} epoch=${best.epoch} cutoff=${best.threshold.toPrecision(8)} modelSHA256=${modelHash}`);
  log(`EXPORT ${path.resolve(params.modelPath)}; run copy=${path.resolve(params.runDir, "model.json")}`);
  log(`TRAIN AUDIT accepted=${trainMetrics.accepted}/${trainMetrics.total}; distribution=${JSON.stringify(trainMetrics.acceptedScoreDistribution)}`);
  let testMetrics;
  let testFingerprint;
  let status = "not-tested";
  if (params.testHash) {
    params.signal?.throwIfAborted();
    const result = await assessment.run(params.testHash, params.modelPath, log);
    testMetrics = result.metrics;
    testFingerprint = result.fingerprint;
    status = result.status;
    if (status === "failed") log("FINAL TEST requirement unmet. No automatic retuning; the exported artifact remains at the model output path.");
  }
  const report = { status, modelHash, trainHash: params.trainHash, testHash: params.testHash, fingerprint, options,
    selection: { seed: best.seed, epoch: best.epoch, threshold: best.threshold, fit: best.fit, validation: best.validation },
    split: { t: split.splitT, fitRows: fit.length, validationRows: validation.length, purgedRows: split.purged },
    candidates, trainMetrics, testMetrics, testFingerprint };
  await jsonFile.write.atomic(path.join(params.runDir, "report.json"), report);
  log(`REPORT ${path.resolve(params.runDir, "report.json")}; outcome=${status}`);
  return report;
}

export default run;
