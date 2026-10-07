import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import featureGate from "@/lib/dev/feature-gate";
import v3 from "@/lib/strategies/default_with_features_gate/features/v3";
import type { NeuralGateArtifact, NeuralInputProfile } from "@/lib/strategies/default_with_features_gate/features/v3";
import inputs from "@/lib/strategies/default_with_features_gate/features/v3/inputs";
import network from "@/lib/strategies/default_with_features_gate/features/v3/network";
import jsonFile from "@/lib/system/storage/json-file";

import assessment from "./assessment";
import dataset from "./dataset";
import type run from "./run";
import selection from "./selection";
import trainer from "./trainer";
import type { NeuralSample, NeuralTrainingOptions, TrainingSample } from "./types";

export interface ResearchTrial { profile: NeuralInputProfile; hidden: number[]; l2: number }

const trials: ResearchTrial[] = ["legacy", "directional"].flatMap((profile) => [
  { profile: profile as NeuralInputProfile, hidden: [], l2: 0.001 },
  { profile: profile as NeuralInputProfile, hidden: [8], l2: 0.001 },
  { profile: profile as NeuralInputProfile, hidden: [16, 8], l2: 0.001 },
  { profile: profile as NeuralInputProfile, hidden: [4], l2: 0.01 },
  { profile: profile as NeuralInputProfile, hidden: [8], l2: 0.01 },
  { profile: profile as NeuralInputProfile, hidden: [8], l2: 0.05 },
]);

/** Fits/scales only the fitting partition; labels outside it can tighten the baseline cutoff. */
async function fit(samples: NeuralSample[], options: NeuralTrainingOptions, seed: number, label: string,
  log: (message: string) => void, signal?: AbortSignal) {
  const split = dataset.split(samples, options.validationFraction, options.gapMs);
  const normalization = inputs.fit(split.fit.map((sample) => sample.raw), options.profile);
  const encode = (sample: NeuralSample): TrainingSample => ({ ...sample, x: inputs.encode(sample.raw, normalization) });
  const fitRows = split.fit.map(encode);
  const validation = split.validation.map(encode);
  const used = new Set([...split.fit, ...split.validation]);
  const calibration = samples.filter((sample) => !used.has(sample)).map(encode);
  const started = Date.now();
  log(`FIT ${label} rows=${fitRows.length} validation=${validation.length} purged=${split.purged}`);
  const model = await trainer.fit(fitRows, validation, options, seed, (progress) => {
    if (progress.epoch === 1 || progress.epoch % options.logEvery === 0 || progress.improved) {
      log(`EPOCH ${label} ${progress.epoch}/${options.epochs} loss=${progress.fitLoss.toFixed(5)} valLoss=${progress.validationLoss.toFixed(5)} valAccepted=${progress.validation.accepted} cutoff=${progress.threshold.toPrecision(6)} elapsed=${((Date.now() - started) / 1000).toFixed(1)}s${progress.improved ? " BEST CHECKPOINT" : ""}`);
    }
  }, signal, calibration);
  if (!model) throw new Error(`${label}: no qualifying checkpoint.`);
  return { model, normalization, split, fitRows, validation, encode };
}

/** Reserves half the lowest unsafe held-out/training risk ratio, rather than touching the validation boundary. */
function margin(predictions: Array<{ score: number; ratio: number }>): number {
  if (!predictions.length || predictions.some((point) => !Number.isFinite(point.ratio) || point.ratio < 0)) {
    throw new Error("Research calibration needs finite nonnegative risk ratios.");
  }
  const unsafe = predictions.filter((point) => point.score >= 3);
  if (!unsafe.length) throw new Error("Research calibration needs unsafe held-out examples.");
  return unsafe.reduce((minimum, point) => Math.min(minimum, point.ratio), 1) * 0.5;
}

/** Searches feature/architecture/regularization families using training coins only, then freezes one candidate before testing. */
async function research(params: Parameters<typeof run>[0] & { trials?: ResearchTrial[] }) {
  const { log } = params;
  if (params.trainHash === params.testHash) throw new Error("Train and test hashes must differ.");
  const bySymbol = await featureGate.dataset.readRows(params.trainHash);
  const rows = Object.values(bySymbol).flat();
  const fingerprint = createHash("sha256").update(JSON.stringify(bySymbol)).digest("hex");
  const families = params.trials ?? trials;
  const total = families.length * params.options.seeds.length;
  const results: Array<Record<string, unknown>> = [];
  let best: { artifact: NeuralGateArtifact; accepted: number; avg: number; record: Record<string, unknown> } | undefined;
  log(`RESEARCH train=${params.trainHash}; families=${families.length}; seeds=${params.options.seeds}; experiments=${total}; test is unread until selection ends`);
  log("OBJECTIVE maximize leave-one-coin-out acceptance with zero score>=3; require every held-out coin and chronological validation to accept rows; safety buffer=50% of lowest unsafe held-out risk ratio");
  let experiment = 0;
  for (const family of families) for (const seed of params.options.seeds) {
    params.signal?.throwIfAborted();
    const options = { ...params.options, ...family, cutoffMargin: 1 };
    const prepared = dataset.prepare(rows, ["BTC"], family.profile);
    const symbols = [...new Set(prepared.samples.map((sample) => sample.row.symbol))].sort();
    if (symbols.length < 3) throw new Error("Cross-coin research requires at least three training coins, excluding BTC.");
    const id = `${family.profile}-${family.hidden.join("x") || "linear"}-l2=${family.l2}-seed=${seed}`;
    log(`EXPERIMENT ${++experiment}/${total} ${id}`);
    const held: Array<{ sample: NeuralSample; score: number; ratio: number }> = [];
    const folds: Array<{ symbol: string; epoch: number; threshold: number }> = [];
    try {
      for (const symbol of symbols) {
        params.signal?.throwIfAborted();
        const model = await fit(prepared.samples.filter((sample) => sample.row.symbol !== symbol), options, seed, `${id} hold=${symbol}`, log, params.signal);
        const points = prepared.samples.filter((sample) => sample.row.symbol === symbol).map((sample) => ({
          sample, score: sample.score, ratio: network.predict(model.model.layers, model.encode(sample).x) / model.model.threshold,
        }));
        held.push(...points);
        folds.push({ symbol, epoch: model.model.epoch, threshold: model.model.threshold });
        log(`HOLDOUT ${symbol} rows=${points.length} unsafe=${points.filter((point) => point.score >= 3).length}`);
      }
      const cutoffMargin = margin(held);
      const accepted = held.filter((point) => point.ratio < cutoffMargin);
      const holdoutCounts = Object.fromEntries(symbols.map((symbol) => [symbol, accepted.filter((point) => point.sample.row.symbol === symbol).length]));
      const average = accepted.length ? accepted.reduce((sum, point) => sum + point.score, 0) / accepted.length : Infinity;
      const base = { id, options, folds, cutoffMargin, holdoutCounts, heldOutAccepted: accepted.length, heldOutTotal: held.length,
        heldOutWorst: accepted.length ? Math.max(...accepted.map((point) => point.score)) : undefined, heldOutAverage: Number.isFinite(average) ? average : undefined };
      if (!cutoffMargin || Object.values(holdoutCounts).some((count) => count === 0)) {
        results.push({ ...base, qualified: false, reason: "Safety margin leaves a held-out coin with no acceptance." });
        log(`REJECT ${id}: held-out counts=${JSON.stringify(holdoutCounts)} margin=${cutoffMargin}`);
      } else {
        const full = await fit(prepared.samples, options, seed, `${id} full`, log, params.signal);
        const threshold = full.model.threshold * cutoffMargin;
        const fitSummary = selection.summarize(full.fitRows, full.fitRows.map((sample) => network.predict(full.model.layers, sample.x)), threshold);
        const validation = selection.summarize(full.validation, full.validation.map((sample) => network.predict(full.model.layers, sample.x)), threshold);
        const record = { ...base, qualified: !!fitSummary.accepted && !!validation.accepted, fit: fitSummary, validation, epoch: full.model.epoch, threshold };
        results.push(record);
        log(`RESULT ${id} CV=${accepted.length}/${held.length} worst=${base.heldOutWorst} margin=${cutoffMargin.toPrecision(6)} fit=${fitSummary.accepted} validation=${validation.accepted} qualified=${record.qualified}`);
        if (record.qualified && (!best || accepted.length > best.accepted || (accepted.length === best.accepted && average < best.avg))) {
          const artifact: NeuralGateArtifact = {
            v: 1, target: "missScore>=3", inputProfile: family.profile, features: [...inputs.namesFor(family.profile)],
            normalization: full.normalization, layers: full.model.layers, threshold,
            training: { hash: params.trainHash, fingerprint, t: Date.now(), seed, epoch: full.model.epoch,
              splitT: full.split.splitT, gapMs: options.gapMs, fitRows: full.fitRows.length, validationRows: full.validation.length,
              purgedRows: full.split.purged, excludedSymbols: ["BTC"], validationAccepted: validation.accepted,
              validationWorstScore: validation.worstScore!, cutoffMargin },
          };
          best = { artifact, accepted: accepted.length, avg: average, record };
          log(`BEST ${id}: training-only cross-coin acceptance=${accepted.length}; test remains unread`);
        }
      }
    } catch (error) {
      params.signal?.throwIfAborted();
      // Only an unqualified checkpoint is a recoverable experiment failure; programming/storage errors must surface.
      if (!(error instanceof Error) || !error.message.endsWith("no qualifying checkpoint.")) throw error;
      results.push({ id, qualified: false, reason: error.message });
      log(`REJECT ${id}: ${error.message}`);
    }
    await jsonFile.write.atomic(path.join(params.runDir, "experiments.json"), { trainHash: params.trainHash, fingerprint, buffer: 0.5, results });
  }
  if (!best) throw new Error("No cross-coin candidate qualified. Test dataset was not read; active model was not replaced.");
  const session = v3.create(best.artifact);
  let trainMetrics;
  try { trainMetrics = featureGate.metrics.scoreRows(session.gate, rows); } finally { session.dispose(); }
  if (!trainMetrics.accepted || (trainMetrics.acceptedScoreDistribution.worstScore ?? Infinity) >= 3) throw new Error("Research export audit failed.");
  const frozenPath = path.join(params.runDir, "model.json");
  await jsonFile.write.atomic(frozenPath, best.artifact);
  const modelHash = createHash("sha256").update(await readFile(frozenPath)).digest("hex");
  log(`FROZEN ${String(best.record.id)} modelSHA256=${modelHash}; candidate=${frozenPath}`);
  log(`TRAIN AUDIT accepted=${trainMetrics.accepted}/${trainMetrics.total}; distribution=${JSON.stringify(trainMetrics.acceptedScoreDistribution)}`);
  params.signal?.throwIfAborted();
  const test = params.testHash ? await assessment.run(params.testHash, frozenPath, log) : undefined;
  const status = test?.status ?? "not-tested";
  if (status !== "failed") {
    await jsonFile.write.atomic(params.modelPath, best.artifact);
    log(`EXPORT ${params.modelPath}`);
  } else log("FINAL TEST failed; candidate retained in research folder; active model not replaced; no retuning against test rows");
  const report = { status, modelHash, trainHash: params.trainHash, testHash: params.testHash, fingerprint, selection: best.record,
    trainMetrics, testMetrics: test?.metrics, testFingerprint: test?.fingerprint, results };
  await jsonFile.write.atomic(path.join(params.runDir, "report.json"), report);
  log(`REPORT ${path.join(params.runDir, "report.json")}; outcome=${status}`);
  return report;
}

const researchAPI = { margin, run: research, trials } as const;
export default researchAPI;
