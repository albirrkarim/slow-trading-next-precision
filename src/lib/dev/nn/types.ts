import type { FeatureGateDatasetRow } from "@/lib/dev/feature-gate";
import type { DenseLayer, NeuralInputProfile } from "@/lib/strategies/default_with_features_gate/features/v3";

export interface NeuralSample {
  row: FeatureGateDatasetRow;
  t: number;
  /** Conservative upper bound: next captured starting point at/after the reversal. Only used for split purging. */
  labelT?: number;
  score: number;
  raw: Array<number | undefined>;
}

export interface TrainingSample extends NeuralSample { x: number[] }

export interface RiskSummary {
  total: number;
  accepted: number;
  violations: number;
  avgScore?: number;
  worstScore?: number;
  counts: Record<string, number>;
}

export interface NeuralCandidate {
  layers: DenseLayer[];
  seed: number;
  epoch: number;
  threshold: number;
  fit: RiskSummary;
  validation: RiskSummary;
  validationLoss: number;
}

export interface NeuralTrainingOptions {
  profile?: NeuralInputProfile;
  /** Conservative multiplier on the training-calibrated cutoff, never selected using test rows. */
  cutoffMargin?: number;
  epochs: number;
  batchSize: number;
  learningRate: number;
  l2: number;
  hidden: number[];
  seeds: number[];
  validationFraction: number;
  gapMs: number;
  logEvery: number;
  patience: number;
}
