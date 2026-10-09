import type { FeatureGate, FeatureGateResult } from "@/lib/strategies/feature-gates";

import type {
  FeatureGateDatasetRow,
  FeatureGateMetrics,
  FeatureGateScoreDistribution,
  FeatureGateSymbolCounts,
} from "./types";
import reasons from "./reasons";

const TOP_REJECTIONS = 8;

/**
 * BTEST:FEATURE_GATE_DATASET — skips uncaptured or invalid rows, then scores
 * captured inputs through the gate: a row is accepted when `allow` is true,
 * and rejections are grouped by `message`. Unresolved rows count toward
 * `total`/`acceptanceRate` but are excluded from every score-based metric.
 * The optional observer receives accepted resolved rows and their gate message
 * from this same scoring pass, so diagnostics never rerun inference.
 */
function scoreRows(
  gate: FeatureGate,
  rows: FeatureGateDatasetRow[],
  onAcceptedResolved?: (row: FeatureGateDatasetRow, message: string) => void,
  onDecision?: (row: FeatureGateDatasetRow, result: FeatureGateResult) => void,
): FeatureGateMetrics {
  const bySymbol: Record<string, FeatureGateSymbolCounts> = {};
  const distribution: FeatureGateScoreDistribution = {};
  const rejections = new Map<string, { count: number; sample: string }>();

  let skipped = 0;
  let total = 0;
  let resolved = 0;
  let accepted = 0;
  let acceptedResolved = 0;
  let acceptedScoreZero = 0;
  let scoreZero = 0;
  let scorePositive = 0;
  let rejectedScorePositive = 0;
  let scoreSum = 0;
  let worstScore = 0;

  for (const row of rows) {
    const signal = row.sequences[0];
    if (
      row.t === undefined || !Number.isFinite(row.t) || !row.feature ||
      !signal || !row.symbol ||
      (row.resolved && (!Number.isInteger(row.missScore) || (row.missScore ?? -1) < 0))
    ) {
      skipped += 1;
      continue;
    }
    const result = gate(row.t, row.feature, { ...signal, symbol: row.symbol });
    onDecision?.(row, result);
    const isAccepted = result.allow;

    total += 1;
    if (isAccepted) {
      accepted += 1;
    } else {
      const reason = result.message;
      // Reasons embed measured values ("envelope is only 3.9% wide") —
      // bucket on the number-stripped template so variants group, and keep
      // one real example for the tooltip.
      const bucket = reasons.template(reason);
      const entry = rejections.get(bucket) ?? { count: 0, sample: reason };
      entry.count += 1;
      rejections.set(bucket, entry);
    }

    const bucket = (bySymbol[row.symbol] ??= {
      accepted: 0,
      resolved: 0,
      total: 0,
    });
    bucket.total += 1;
    if (isAccepted) bucket.accepted += 1;

    if (!row.resolved) continue;
    resolved += 1;
    bucket.resolved += 1;

    const score = row.missScore ?? 0;
    if (score === 0) {
      scoreZero += 1;
    } else {
      scorePositive += 1;
    }

    if (isAccepted) {
      acceptedResolved += 1;
      onAcceptedResolved?.(row, result.message);
      if (score === 0) acceptedScoreZero += 1;
      scoreSum += score;
      if (score > worstScore) worstScore = score;
      const key = String(score);
      distribution[key] = (distribution[key] ?? 0) + 1;
    } else if (score > 0) {
      rejectedScorePositive += 1;
    }
  }

  if (acceptedResolved > 0) {
    distribution.avgScore = scoreSum / acceptedResolved;
    distribution.worstScore = worstScore;
  }

  return {
    acceptanceRate: total > 0 ? accepted / total : 0,
    accepted,
    acceptedQuality:
      acceptedResolved > 0 ? acceptedScoreZero / acceptedResolved : undefined,
    acceptedScoreDistribution: distribution,
    badBlocked:
      scorePositive > 0 ? rejectedScorePositive / scorePositive : undefined,
    bySymbol,
    goodRetained: scoreZero > 0 ? acceptedScoreZero / scoreZero : undefined,
    rejected: total - accepted,
    resolved,
    skipped,
    topRejections: [...rejections.entries()]
      .map(([reason, entry]) => ({
        count: entry.count,
        reason,
        sample: entry.sample,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, TOP_REJECTIONS),
    total,
  };
}

const metrics = { scoreRows } as const;

export default metrics;
