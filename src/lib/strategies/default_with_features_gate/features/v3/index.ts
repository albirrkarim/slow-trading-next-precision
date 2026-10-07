import type { FeatureGateSession } from "@/lib/strategies/feature-gates";

import artifactFormat from "./artifact";
import inputs from "./inputs";
import network from "./network";
import type { NeuralGateArtifact } from "./types";

/** Creates an isolated, warmed inference session; disposal cannot affect another engine or evaluation. */
function create(value: NeuralGateArtifact): FeatureGateSession {
  artifactFormat.validate(value);
  const model = structuredClone(value);
  let disposed = false;
  // Warm up the same CPU forward path before scoring real rows. No learning occurs.
  network.predict(model.layers, new Array<number>(inputs.names.length * 2).fill(0));
  return {
    gate: (currentTime, features, signal) => {
      if (disposed) throw new Error("v3 NN session has been disposed.");
      const symbol = (signal.symbol ?? "").toUpperCase().replace(/_USDT$/, "");
      if (model.training.excludedSymbols.includes(symbol)) return { allow: false, message: "v3 NN: anchor-only symbol" };
      if (!inputs.valid(currentTime, features, signal)) {
        return { allow: false, message: "v3 NN: invalid capture inputs" };
      }
      const score = network.predict(model.layers, inputs.encode(inputs.read(currentTime, features, signal), model.normalization));
      if (!Number.isFinite(score)) return { allow: false, message: "v3 NN: nonfinite risk score" };
      const allow = score < model.threshold;
      return { allow, message: `v3 NN: risk ${score} ${allow ? "<" : ">="} cutoff ${model.threshold} (${allow ? "allowed" : "rejected"})` };
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const layer of model.layers) { layer.w.fill(0); layer.b.fill(0); }
      model.layers.length = 0;
      model.normalization.mean.length = 0;
      model.normalization.std.length = 0;
    },
  };
}

/** Loads saved weights once per engine/evaluation. The saved artifact survives in-memory disposal. */
async function load(file?: string): Promise<FeatureGateSession> {
  const [{ readFile }, { default: path }] = await Promise.all([import("node:fs/promises"), import("node:path")]);
  const target = file ?? path.resolve("src/lib/strategies/default_with_features_gate/features/v3/model.json");
  let value: unknown;
  try {
    value = JSON.parse(await readFile(target, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("v3 NN model is missing. Run npm run nn:train first.");
    throw error;
  }
  artifactFormat.validate(value);
  return create(value);
}

const featureGateV3 = { create, load } as const;
export default featureGateV3;
export type * from "./types";
