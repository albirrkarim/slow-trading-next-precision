import type { DenseLayer } from "./types";

/** Stable sigmoid, including large negative logits. */
function sigmoid(value: number): number {
  return value >= 0 ? 1 / (1 + Math.exp(-value)) : Math.exp(value) / (1 + Math.exp(value));
}

/** Runs tanh hidden layers and a sigmoid output; returns activations for training backpropagation. */
function forward(layers: DenseLayer[], input: number[]): number[][] {
  const activations = [input];
  for (const [index, layer] of layers.entries()) {
    const previous = activations[activations.length - 1];
    if (previous.length !== layer.input) throw new Error("NN layer input width mismatch.");
    const output = new Array<number>(layer.output);
    for (let j = 0; j < layer.output; j++) {
      let value = layer.b[j];
      for (let i = 0; i < layer.input; i++) value += layer.w[j * layer.input + i] * previous[i];
      output[j] = index === layers.length - 1 ? sigmoid(value) : Math.tanh(value);
    }
    activations.push(output);
  }
  return activations;
}

/** Computes the trained unsafe-outcome ranking score. */
function predict(layers: DenseLayer[], input: number[]): number {
  return forward(layers, input).at(-1)![0];
}

const network = { forward, predict } as const;
export default network;
