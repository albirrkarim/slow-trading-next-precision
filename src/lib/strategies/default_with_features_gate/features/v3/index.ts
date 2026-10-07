import type { FeatureGateSession } from "@/lib/strategies/feature-gates";

import artifactFormat from "./artifact";
import hardRules from "./hard-rules";
import cutoff from "./cutoff";
import inputs from "./inputs";
import network from "./network";
import type { NeuralGateArtifact } from "./types";

type GateArgs = Parameters<FeatureGateSession["gate"]>;
interface NeuralSession extends FeatureGateSession {
  /** Normalized primitive risk for consensus; an input/rule veto contributes infinity. */
  rank: (...args: GateArgs) => { score: number; ratio: number; message: string };
}

/** Creates an isolated, warmed inference session; disposal cannot affect another engine or evaluation. */
function create(value: NeuralGateArtifact): NeuralSession {
  artifactFormat.validate(value);
  const { alternatives: members, ...primaryModel } = value;
  const model = structuredClone(primaryModel);
  const models = [model.layers, ...(model.ensemble ?? [])];
  const alternatives = (members ?? []).map(create);
  let disposed = false;
  // Warm up the same CPU forward path before scoring real rows. No learning occurs.
  network.mean(models, new Array<number>(model.features.length * 2).fill(0), model.activation);
  /** Scores one specialist with its frozen preprocessing and context cutoff. */
  const read = (currentTime: GateArgs[0], features: GateArgs[1], signal: GateArgs[2]) => {
    if (disposed) throw new Error("v3 NN session has been disposed.");
    const symbol = (signal.symbol ?? "").toUpperCase().replace(/_USDT$/, "");
    if (model.training.excludedSymbols.includes(symbol)) return { score: Infinity, ratio: Infinity, message: "v3 NN: anchor-only symbol" };
    if (!inputs.valid(currentTime, features, signal)) return { score: Infinity, ratio: Infinity, message: "v3 NN: invalid capture inputs" };
    const score = network.mean(models, inputs.encode(inputs.read(currentTime, features, signal, model.inputProfile), model.normalization), model.activation);
    if (!Number.isFinite(score)) return { score: Infinity, ratio: Infinity, message: "v3 NN: nonfinite risk score" };
    const { group, threshold } = cutoff.resolve(model.threshold, model.cutoffs, signal, features, model.cutoffProfile);
    return { score, ratio: score / threshold, message: `v3 NN: risk ${score} ${score < threshold ? "<" : ">="} cutoff ${threshold}${model.cutoffs ? ` group=${group}` : ""}` };
  };
  return {
    rank: (...args) => {
      const result = read(...args);
      if (!Number.isFinite(result.ratio)) return result;
      const veto = hardRules.rejection(model.hardRules ?? [], ...args);
      return veto === undefined ? result : { score: Infinity, ratio: Infinity, message: `${result.message}; hard rejection ${veto}` };
    },
    gate: (currentTime, features, signal) => {
      const primary = read(currentTime, features, signal);
      if (!Number.isFinite(primary.ratio)) return { allow: false, message: primary.message };
      let allow = primary.ratio < 1;
      let memberMessage = primary.message;
      if (model.aggregation === "mean") {
        const scores = [primary.score, ...alternatives.map((member) => member.rank(currentTime, features, signal).score)];
        const score = scores.reduce((sum, entry) => sum + entry, 0) / scores.length;
        const { group, threshold } = cutoff.resolve(model.threshold, model.cutoffs, signal, features, model.cutoffProfile);
        allow = Number.isFinite(score) && score < threshold;
        memberMessage = `v3 NN blend: ${scores.length} specialist mean risk ${score} ${allow ? "<" : ">="} cutoff ${threshold} group=${group}`;
      } else if (model.consensus) {
        const risks = [primary.ratio, ...alternatives.map((member) => member.rank(currentTime, features, signal).ratio)].sort((a, b) => a - b);
        const ratio = risks[model.consensus.votes - 1];
        allow = ratio < model.consensus.threshold;
        memberMessage = `v3 NN consensus: ${model.consensus.votes}/${risks.length} specialist risk ratio ${ratio} ${allow ? "<" : ">="} cutoff ${model.consensus.threshold}`;
      } else if (!allow) {
        for (const [i, alternative] of alternatives.entries()) {
          const result = alternative.gate(currentTime, features, signal);
          if (result.allow) { allow = true; memberMessage = `v3 specialist ${i + 1}: ${result.message}`; break; }
        }
      }
      if (allow) {
        const veto = hardRules.rejection(model.hardRules ?? [], currentTime, features, signal);
        if (veto !== undefined) return { allow: false, message: `${memberMessage}; hard rejection ${veto}` };
      }
      return { allow, message: `${memberMessage} (${allow ? "allowed" : "rejected"})${allow && model.hardRules?.length ? `; hard rules passed: ${model.hardRules.join(", ")}` : ""}` };
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const alternative of alternatives) alternative.dispose();
      alternatives.length = 0;
      for (const layers of models) {
        for (const layer of layers) { layer.w.fill(0); layer.b.fill(0); }
        layers.length = 0;
      }
      models.length = 0;
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
