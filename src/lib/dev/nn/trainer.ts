import network from "@/lib/strategies/default_with_features_gate/features/v3/network";

import optimizer from "./optimizer";
import selection from "./selection";
import type { NeuralCandidate, NeuralTrainingOptions, TrainingSample } from "./types";

export interface EpochProgress {
  seed: number;
  epoch: number;
  fitLoss: number;
  validationLoss: number;
  threshold: number;
  fit: NeuralCandidate["fit"];
  validation: NeuralCandidate["validation"];
  improved: boolean;
}

/** Fits one seeded MLP, selecting checkpoints by validation acceptance under the hard score limit. */
async function fit(fitRows: TrainingSample[], validation: TrainingSample[], options: NeuralTrainingOptions, seed: number,
  onEpoch: (progress: EpochProgress) => void, signal?: AbortSignal, calibration: TrainingSample[] = []): Promise<NeuralCandidate | undefined> {
  const rng = optimizer.random(seed);
  const layers = optimizer.initialize([fitRows[0].x.length, ...options.hidden, 1], rng);
  const update = optimizer.adam(layers, options.learningRate, options.l2);
  const indices = fitRows.map((_, index) => index);
  const fitTargets = fitRows.map((row) => Number(row.score >= 3));
  const validationTargets = validation.map((row) => Number(row.score >= 3));
  const unsafeCount = fitTargets.reduce((sum, value) => sum + value, 0);
  const unsafeWeight = Math.min(50, (fitRows.length - unsafeCount) / unsafeCount);
  let best: NeuralCandidate | undefined;
  let stale = 0;
  for (let epoch = 1; epoch <= options.epochs; epoch++) {
    signal?.throwIfAborted();
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    for (let start = 0; start < indices.length; start += options.batchSize) {
      const gradient = optimizer.zeros(layers);
      const end = Math.min(indices.length, start + options.batchSize);
      for (let i = start; i < end; i++) {
        const index = indices[i];
        optimizer.accumulate(layers, gradient, fitRows[index].x, fitTargets[index], unsafeWeight);
      }
      update(gradient, end - start);
    }
    const fitPredictions = fitRows.map((row) => network.predict(layers, row.x));
    const validationPredictions = validation.map((row) => network.predict(layers, row.x));
    const calibrationPredictions = calibration.map((row) => network.predict(layers, row.x));
    const threshold = selection.cutoff([{ samples: fitRows, predictions: fitPredictions }, { samples: validation, predictions: validationPredictions }, { samples: calibration, predictions: calibrationPredictions }]);
    const candidate: NeuralCandidate = {
      layers, seed, epoch, threshold,
      fit: selection.summarize(fitRows, fitPredictions, threshold),
      validation: selection.summarize(validation, validationPredictions, threshold),
      validationLoss: optimizer.loss(validationPredictions, validationTargets, unsafeWeight),
    };
    const improved = selection.better(candidate, best);
    if (improved) { best = structuredClone(candidate); stale = 0; } else stale++;
    onEpoch({ seed, epoch, fitLoss: optimizer.loss(fitPredictions, fitTargets, unsafeWeight), validationLoss: candidate.validationLoss,
      threshold, fit: candidate.fit, validation: candidate.validation, improved });
    if (stale >= options.patience) break;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return best;
}

const trainer = { fit } as const;
export default trainer;
