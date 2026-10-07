import {
  FEATURE_GATE_REGISTRY,
  type FeatureGateSlug,
} from "@/lib/strategies/feature-gates";

import dataset from "./dataset";
import metrics from "./metrics";
import type { FeatureGateAcceptedHighScoreRow, FeatureGateDatasetRow, FeatureGateReport } from "./types";

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
  // BTEST:FEATURE_NN — prepare once before scoring, release even if scoring fails.
  const session = "prepare" in entry ? await entry.prepare() : { gate: entry.gate, dispose: () => undefined };
  try {
    const acceptedHighScoreRows: FeatureGateAcceptedHighScoreRow[] = [];
    const scored = metrics.scoreRows(session.gate, allRows(rows), (row, message) => {
      if ((row.missScore ?? -1) < 3) return;
      acceptedHighScoreRows.push({
        t: row.t!,
        symbol: row.symbol,
        signalId: row.sequences[0].id,
        missScore: row.missScore!,
        message,
      });
    });
    acceptedHighScoreRows.sort((a, b) => b.missScore - a.missScore || a.t - b.t);
    return {
      acceptedHighScoreRows,
      hash: params.hash,
      metrics: scored,
      slug: params.slug,
    };
  } finally {
    session.dispose();
  }
}

export default evaluate;
