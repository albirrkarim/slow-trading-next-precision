import {
  FEATURE_GATE_REGISTRY,
  type FeatureGate,
  type FeatureGateSlug,
} from "@/lib/strategies/feature-gates";

import dataset from "./dataset";
import metrics from "./metrics";
import type { FeatureGateAcceptedHighScoreRow, FeatureGateDatasetRow, FeatureGateReport } from "./types";

/** Flattens the symbol-grouped dataset map into one row list. */
function allRows(bySymbol: Record<string, FeatureGateDatasetRow[]>) {
  return Object.values(bySymbol).flat();
}

/** Validates a selectable gate's checks and resolves its versioned default. */
function selectedSubGates(slug: string, value: unknown): string[] | undefined {
  const entry = FEATURE_GATE_REGISTRY[slug as FeatureGateSlug];
  const subGates = entry && "subGates" in entry ? entry.subGates : undefined;
  if (value === undefined) {
    return subGates ? ("defaultSubGates" in entry ? [...entry.defaultSubGates] : Object.keys(subGates)) : undefined;
  }
  if (!subGates) {
    throw new Error('"enabledSubGates" is only supported for gates with selectable checks.');
  }
  const available = Object.keys(subGates);
  if (
    !Array.isArray(value) ||
    value.some((key) => typeof key !== "string" || !available.includes(key)) ||
    new Set(value).size !== value.length
  ) {
    throw new Error(
      `"enabledSubGates" must contain unique ${slug} check ids: ${available.join(", ")}.`,
    );
  }
  return value as string[];
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
  enabledSubGates?: unknown;
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

  const enabledSubGates = selectedSubGates(params.slug, params.enabledSubGates);

  const rows = await dataset.readRows(params.hash);
  // BTEST:FEATURE_NN — prepare once before scoring, release even if scoring fails.
  const session = "prepare" in entry ? await entry.prepare() : { gate: entry.gate, dispose: () => undefined };
  try {
    const gate: FeatureGate = params.slug === "v4"
      ? ((time, features, signal) =>
          FEATURE_GATE_REGISTRY.v4.gate(time, features, signal, enabledSubGates))
      : params.slug === "v5"
        ? ((time, features, signal) =>
            FEATURE_GATE_REGISTRY.v5.gate(time, features, signal, enabledSubGates))
      : session.gate;
    const acceptedHighScoreRows: FeatureGateAcceptedHighScoreRow[] = [];
    const scored = metrics.scoreRows(gate, allRows(rows), (row, message) => {
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
      ...(enabledSubGates && { enabledSubGates }),
    };
  } finally {
    session.dispose();
  }
}

export default evaluate;
