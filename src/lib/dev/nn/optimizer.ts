import network from "@/lib/strategies/default_with_features_gate/features/v3/network";
import type { DenseLayer } from "@/lib/strategies/default_with_features_gate/features/v3";

/** Deterministic generator used for initialization and mini-batch shuffling. */
/* eslint-disable no-bitwise -- Mulberry32 requires unsigned integer mixing for reproducible training. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
/* eslint-enable no-bitwise */

/** Xavier initialization for tanh dense layers. */
function initialize(widths: number[], rng: () => number): DenseLayer[] {
  return widths.slice(1).map((output, index) => {
    const input = widths[index];
    const limit = Math.sqrt(6 / (input + output));
    return { input, output, w: Array.from({ length: input * output }, () => (rng() * 2 - 1) * limit), b: new Array<number>(output).fill(0) };
  });
}

/** Weighted binary cross-entropy for the unsafe-outcome classifier. */
function loss(predictions: number[], targets: number[], unsafeWeight: number): number {
  return predictions.reduce((sum, prediction, index) => {
    const p = Math.max(1e-12, Math.min(1 - 1e-12, prediction));
    return sum - (targets[index] ? unsafeWeight * Math.log(p) : Math.log(1 - p));
  }, 0) / predictions.length;
}

/** Backpropagates weighted sigmoid cross-entropy into a batch gradient accumulator. */
function accumulate(layers: DenseLayer[], gradient: DenseLayer[], input: number[], target: number, unsafeWeight: number): void {
  const activations = network.forward(layers, input);
  let delta = [(activations.at(-1)![0] - target) * (target ? unsafeWeight : 1)];
  for (let l = layers.length - 1; l >= 0; l--) {
    const layer = layers[l];
    const previous = activations[l];
    const nextDelta = new Array<number>(layer.input).fill(0);
    for (let j = 0; j < layer.output; j++) {
      gradient[l].b[j] += delta[j];
      for (let i = 0; i < layer.input; i++) {
        const index = j * layer.input + i;
        gradient[l].w[index] += delta[j] * previous[i];
        nextDelta[i] += layer.w[index] * delta[j];
      }
    }
    if (l > 0) for (let i = 0; i < nextDelta.length; i++) nextDelta[i] *= 1 - previous[i] ** 2;
    delta = nextDelta;
  }
}

/** Allocates one zero-valued array set matching the dense parameters. */
function zeros(layers: DenseLayer[]): DenseLayer[] {
  return layers.map((layer) => ({ input: layer.input, output: layer.output, w: layer.w.map(() => 0), b: layer.b.map(() => 0) }));
}

/** Creates Adam with first/second moments and bias correction; L2 applies to weights only. */
function adam(layers: DenseLayer[], learningRate: number, l2: number) {
  const m = zeros(layers);
  const v = zeros(layers);
  let step = 0;
  return (gradient: DenseLayer[], batchSize: number) => {
    step++;
    for (let l = 0; l < layers.length; l++) for (const key of ["w", "b"] as const) {
      for (let i = 0; i < layers[l][key].length; i++) {
        const g = gradient[l][key][i] / batchSize + (key === "w" ? l2 * layers[l].w[i] : 0);
        m[l][key][i] = 0.9 * m[l][key][i] + 0.1 * g;
        v[l][key][i] = 0.999 * v[l][key][i] + 0.001 * g * g;
        layers[l][key][i] -= learningRate * (m[l][key][i] / (1 - 0.9 ** step)) / (Math.sqrt(v[l][key][i] / (1 - 0.999 ** step)) + 1e-8);
      }
    }
  };
}

const optimizer = { accumulate, adam, initialize, loss, random, zeros } as const;
export default optimizer;
