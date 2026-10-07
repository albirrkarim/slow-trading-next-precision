import type { DenseLayer } from "./types";

/** Stable sigmoid, including large negative logits. */
function sigmoid(value: number): number {
  return value >= 0 ? 1 / (1 + Math.exp(-value)) : Math.exp(value) / (1 + Math.exp(value));
}

/** Runs persisted hidden activations and a sigmoid output; old artifacts retain tanh. */
function forward(layers: DenseLayer[], input: number[], activation: "tanh" | "relu" = "tanh"): number[][] {
  const activations = [input];
  for (const [index, layer] of layers.entries()) {
    const previous = activations[activations.length - 1];
    if (previous.length !== layer.input) throw new Error("NN layer input width mismatch.");
    const output = new Array<number>(layer.output);
    for (let j = 0; j < layer.output; j++) {
      let value = layer.b[j];
      for (let i = 0; i < layer.input; i++) value += layer.w[j * layer.input + i] * previous[i];
      output[j] = index === layers.length - 1 ? sigmoid(value) : activation === "relu" ? Math.max(0, value) : Math.tanh(value);
    }
    activations.push(output);
  }
  return activations;
}

/** Computes the trained unsafe-outcome ranking score. */
function predict(layers: DenseLayer[], input: number[], activation: "tanh" | "relu" = "tanh"): number {
  return forward(layers, input, activation).at(-1)![0];
}

/** Averages independent network scores using the same input/preprocessing. */
function mean(models: DenseLayer[][], input: number[], activation: "tanh" | "relu" = "tanh"): number {
  if (!models.length) throw new Error("NN ensemble must contain at least one network.");
  return models.reduce((sum, layers) => sum + predict(layers, input, activation), 0) / models.length;
}

const network = { forward, mean, predict } as const;
export default network;
