import inputs from "./inputs";
import hardRules from "./hard-rules";
import cutoff from "./cutoff";
import type { NeuralGateArtifact } from "./types";

/** Validates weights and preprocessing before any model can enter the evaluation loop. */
function validate(value: unknown): asserts value is NeuralGateArtifact {
  const artifact = value as NeuralGateArtifact | undefined;
  const finiteArray = (array: unknown, length: number): array is number[] =>
    Array.isArray(array) && array.length === length && array.every((entry) => typeof entry === "number" && Number.isFinite(entry));
  const names = inputs.namesFor(artifact?.inputProfile);
  const cutoffKeys: readonly string[] = artifact?.cutoffProfile === "hierarchical" ? cutoff.hierarchicalKeys : cutoff.keys;
  if (!artifact || artifact.v !== 1 || artifact.target !== "missScore>=3" ||
      (artifact.activation !== undefined && artifact.activation !== "tanh" && artifact.activation !== "relu") ||
      (artifact.inputProfile !== undefined && !["legacy", "directional", "contextual"].includes(artifact.inputProfile)) ||
      JSON.stringify(artifact.features) !== JSON.stringify(names) ||
      !artifact.normalization || !finiteArray(artifact.normalization.mean, names.length) ||
      !finiteArray(artifact.normalization.std, names.length) || artifact.normalization.std.some((std) => std <= 0) ||
      !Number.isFinite(artifact.normalization.clip) || artifact.normalization.clip <= 0 ||
      !Number.isFinite(artifact.threshold) || artifact.threshold <= 0 || artifact.threshold > 1 ||
      !Array.isArray(artifact.layers) || !artifact.layers.length || artifact.layers.length > 8 ||
      (artifact.ensemble !== undefined && (!Array.isArray(artifact.ensemble) || artifact.ensemble.length > 15)) ||
      (artifact.hardRules !== undefined && (!Array.isArray(artifact.hardRules) || artifact.hardRules.some((rule) => !hardRules.names.includes(rule)))) ||
      (artifact.cutoffs !== undefined && (!artifact.cutoffs || typeof artifact.cutoffs !== "object" || Array.isArray(artifact.cutoffs) ||
        Object.entries(artifact.cutoffs).some(([key, entry]) => !cutoffKeys.includes(key) || typeof entry !== "number" || !Number.isFinite(entry) || entry <= 0 || entry > 1))) ||
      (artifact.cutoffProfile !== undefined && artifact.cutoffProfile !== "side-level" && artifact.cutoffProfile !== "hierarchical") ||
      (artifact.alternatives !== undefined && (!Array.isArray(artifact.alternatives) || artifact.alternatives.length > 15 ||
        artifact.alternatives.some((member) => !member || member.alternatives !== undefined))) ||
      (artifact.consensus !== undefined && (!artifact.consensus || !Number.isInteger(artifact.consensus.votes) ||
        artifact.consensus.votes < 2 || artifact.consensus.votes > (artifact.alternatives?.length ?? 0) + 1 ||
        !Number.isFinite(artifact.consensus.threshold) || artifact.consensus.threshold <= 0)) ||
      (artifact.aggregation !== undefined && (artifact.aggregation !== "mean" || artifact.consensus !== undefined)) ||
      !artifact.training || !Array.isArray(artifact.training.excludedSymbols) ||
      !artifact.training.excludedSymbols.every((symbol) => typeof symbol === "string")) {
    throw new Error("Invalid v3 NN artifact: version, features, normalization or cutoff mismatch.");
  }
  for (const layers of [artifact.layers, ...(artifact.ensemble ?? [])]) {
    if (!Array.isArray(layers) || !layers.length || layers.length > 8) throw new Error("Invalid v3 NN artifact: malformed ensemble member.");
    let width = names.length * 2;
    for (const layer of layers) {
      if (!layer || layer.input !== width || !Number.isInteger(layer.output) || layer.output < 1 || layer.output > 1024 ||
          !finiteArray(layer.w, layer.input * layer.output) || !finiteArray(layer.b, layer.output)) {
        throw new Error("Invalid v3 NN artifact: malformed dense layer weights.");
      }
      width = layer.output;
    }
    if (width !== 1) throw new Error("Invalid v3 NN artifact: expected one risk output.");
  }
  for (const member of artifact.alternatives ?? []) validate(member);
}

const artifact: { validate: typeof validate } = { validate };
export default artifact;
