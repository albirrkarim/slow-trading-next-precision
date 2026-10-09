import v1 from "@/lib/strategies/default_with_features_gate/features/v1/feature_gate_v1";
import v2 from "@/lib/strategies/default_with_features_gate/features/v2/feature_gate_v2";
import neuralSession from "@/lib/strategies/default_with_features_gate/features/v3/session";
import type { NeuralGateArtifact } from "@/lib/strategies/default_with_features_gate/features/v3/types";
import streakV1 from "@/lib/strategies/streak_with_feature_gate/feature_gate_streak_v1";
import type { FeatureGate, FeatureGateResult, FeatureGateSession } from "@/lib/strategies/feature-gates";

import metrics from "./metrics";
import type { FeatureGateDatasetRow, FeatureGateMetrics } from "./types";

export interface ClientEvaluationInput {
  rows: FeatureGateDatasetRow[];
  slug: string;
  modelUrl: string;
}

export interface ClientEvaluationResult {
  decisions: Array<FeatureGateResult | null>;
  metrics: FeatureGateMetrics;
}

/** Scores the complete captured run in a browser worker with the shared gate and metric functions. */
async function evaluate(input: ClientEvaluationInput): Promise<ClientEvaluationResult> {
  const rules: Record<string, FeatureGate> = { streak_v1: streakV1, v1, v2 };
  let session: FeatureGateSession | undefined;
  if (input.slug === "v3") {
    const response = await fetch(input.modelUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`Failed to load v3 model (${response.status}).`);
    session = neuralSession.create(await response.json() as NeuralGateArtifact);
  }
  const gate = session?.gate ?? rules[input.slug];
  if (!gate) throw new Error(`Unknown feature gate: ${input.slug}`);
  const indices = new Map(input.rows.map((row, index) => [row, index]));
  const decisions: ClientEvaluationResult["decisions"] = Array(input.rows.length).fill(null);
  try {
    const scored = metrics.scoreRows(gate, input.rows, undefined, (row, result) => {
      const index = indices.get(row);
      if (index !== undefined) decisions[index] = result;
    });
    return { decisions, metrics: scored };
  } finally {
    session?.dispose();
  }
}

const clientFeatureGate = { evaluate } as const;
export default clientFeatureGate;
