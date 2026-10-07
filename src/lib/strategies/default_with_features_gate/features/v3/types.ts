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
export type NeuralInputProfile = "legacy" | "directional";

/** Versioned, portable CPU MLP artifact. The output is a weighted risk score, not a calibrated probability. */
export interface NeuralGateArtifact {
  v: 1;
  target: "missScore>=3";
  /** Absent in older artifacts, which use the original 34-feature vector. */
  inputProfile?: NeuralInputProfile;
  features: string[];
  normalization: InputNormalization;
  layers: DenseLayer[];
  /** Accept strictly below this frozen cutoff; equal scores are rejected. */
  threshold: number;
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
  };
}
