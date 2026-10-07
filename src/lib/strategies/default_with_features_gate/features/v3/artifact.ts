import inputs from "./inputs";
import type { NeuralGateArtifact } from "./types";

/** Validates weights and preprocessing before any model can enter the evaluation loop. */
function validate(value: unknown): asserts value is NeuralGateArtifact {
  const artifact = value as NeuralGateArtifact | undefined;
  const finiteArray = (array: unknown, length: number): array is number[] =>
    Array.isArray(array) && array.length === length && array.every((entry) => typeof entry === "number" && Number.isFinite(entry));
  if (!artifact || artifact.v !== 1 || artifact.target !== "missScore>=3" ||
      JSON.stringify(artifact.features) !== JSON.stringify(inputs.names) ||
      !artifact.normalization || !finiteArray(artifact.normalization.mean, inputs.names.length) ||
      !finiteArray(artifact.normalization.std, inputs.names.length) || artifact.normalization.std.some((std) => std <= 0) ||
      !Number.isFinite(artifact.normalization.clip) || artifact.normalization.clip <= 0 ||
      !Number.isFinite(artifact.threshold) || artifact.threshold <= 0 || artifact.threshold > 1 ||
      !Array.isArray(artifact.layers) || !artifact.layers.length || artifact.layers.length > 8 ||
      !artifact.training || !Array.isArray(artifact.training.excludedSymbols) ||
      !artifact.training.excludedSymbols.every((symbol) => typeof symbol === "string")) {
    throw new Error("Invalid v3 NN artifact: version, features, normalization or cutoff mismatch.");
  }
  let width = inputs.names.length * 2;
  for (const layer of artifact.layers) {
    if (!layer || layer.input !== width || !Number.isInteger(layer.output) || layer.output < 1 || layer.output > 1024 ||
        !finiteArray(layer.w, layer.input * layer.output) || !finiteArray(layer.b, layer.output)) {
      throw new Error("Invalid v3 NN artifact: malformed dense layer weights.");
    }
    width = layer.output;
  }
  if (width !== 1) throw new Error("Invalid v3 NN artifact: expected one risk output.");
}

const artifact: { validate: typeof validate } = { validate };
export default artifact;
