import { FEATURE_GATE_REGISTRY } from "@/lib/strategies/feature-gates";

import dataset from "./dataset";
import evaluate from "./evaluate";
import metrics from "./metrics";
import type { FeatureGateInfo } from "./types";

/** Gate versions exposed to the evaluation UI, in registry order. */
function list(): FeatureGateInfo[] {
  return Object.entries(FEATURE_GATE_REGISTRY).map(([slug, entry]) => ({
    label: entry.label,
    slug,
    ...("subGates" in entry && { subGates: entry.subGates }),
  }));
}

const featureGate = {
  dataset,
  evaluate,
  list,
  metrics,
} as const;

export default featureGate;
export type * from "./types";
