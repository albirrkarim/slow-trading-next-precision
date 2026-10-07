import type { NeuralHardRule } from "./hard-rules";

/** Dense layer: output-major weights, one bias per output neuron. */
export interface DenseLayer {
  input: number;
  output: number;
  w: number[];
  b: number[];
}

/** Fitted only on training inputs; missing values become zero with a separate presence bit. */
export interface InputNormalization {
  mean: number[];
  std: number[];
  clip: number;
}

/** Legacy preprocessing remains loadable after adding direction-aligned features. */
export type NeuralInputProfile = "legacy" | "directional" | "contextual";

/** Versioned, portable CPU MLP artifact. The output is a weighted risk score, not a calibrated probability. */
export interface NeuralGateArtifact {
  v: 1;
  target: "missScore>=3";
  /** Absent in older artifacts, which use the original 34-feature vector. */
  inputProfile?: NeuralInputProfile;
  /** Omitted by older artifacts, which use tanh hidden layers. Output always uses sigmoid. */
  activation?: "tanh" | "relu";
  features: string[];
  normalization: InputNormalization;
  layers: DenseLayer[];
  /** Additional independent networks using the same frozen preprocessing; risk is their mean with `layers`. */
  ensemble?: DenseLayer[][];
  /** Frozen veto policy applied after NN acceptance; absent in older NN-only artifacts. */
  hardRules?: NeuralHardRule[];
  /** Accept strictly below this frozen cutoff; equal scores are rejected. */
  threshold: number;
  /** Optional training-calibrated direction/level cutoffs. Sparse groups use `threshold`. */
  cutoffs?: Record<string, number>;
  /** Missing means the original flat side/level partitions. */
  cutoffProfile?: "side-level" | "hierarchical";
  /** Independent frozen specialists. Any member may allow; the root hard policy vetoes their union. No nested unions. */
  alternatives?: NeuralGateArtifact[];
  /** Calibrated agreement across independent specialists: compare the nth-lowest normalized risk with this cutoff. */
  consensus?: { votes: number; threshold: number };
  /** Optional mean of independently preprocessed raw sigmoid scores; root cutoffs calibrate that mean. */
  aggregation?: "mean";
  training: {
    hash: string;
    fingerprint: string;
    t: number;
    seed: number;
    epoch: number;
    splitT: number;
    gapMs: number;
    fitRows: number;
    validationRows: number;
    purgedRows: number;
    excludedSymbols: string[];
    validationAccepted: number;
    validationWorstScore: number;
    /** Training-only safety margin; applied after checkpoint selection. */
    cutoffMargin?: number;
    /** Learning target can be stricter than the score>=3 outcome used to calibrate the gate. */
    learningTarget?: 1 | 2 | 3;
    /** Ordinal training uses auxiliary >=1 and >=2 heads; only the >=3 head is exported. */
    objective?: "binary" | "ordinal";
    backend?: "native" | "torch";
    seeds?: number[];
    epochs?: number[];
  };
}
