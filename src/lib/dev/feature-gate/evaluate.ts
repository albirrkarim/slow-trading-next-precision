import {
  FEATURE_GATE_REGISTRY,
  type FeatureGateSlug,
} from "@/lib/strategies/feature-gates";

import dataset from "./dataset";
import metrics from "./metrics";
import type { FeatureGateDatasetRow, FeatureGateReport } from "./types";

/** Flattens the symbol-grouped dataset map into one row list. */
function allRows(bySymbol: Record<string, FeatureGateDatasetRow[]>) {
  return Object.values(bySymbol).flat();
}

/**
 * Replays a gate version over one run's dataset: the hash loads its
 * `<cache>/dataset/*.json` rows (train or test — the caller decides which
 * run plays which role), the gate judges captured rows using only
 * currentTime, pruned features, and the frozen signal. Metrics follow
 * docs/STRATEGY/FEATURE_EXTRACTION.md.
 */
async function evaluate(params: {
  hash: string;
  slug: string;
}): Promise<FeatureGateReport> {
  const entry = Object.hasOwn(FEATURE_GATE_REGISTRY, params.slug)
    ? FEATURE_GATE_REGISTRY[params.slug as FeatureGateSlug]
    : undefined;
  if (!entry) {
    throw new Error(
      `Unknown feature gate slug "${params.slug}" — expected one of: ` +
        Object.keys(FEATURE_GATE_REGISTRY).join(", "),
    );
  }

  const rows = await dataset.readRows(params.hash);
  return {
    hash: params.hash,
    metrics: metrics.scoreRows(entry.gate, allRows(rows)),
    slug: params.slug,
  };
}

export default evaluate;
