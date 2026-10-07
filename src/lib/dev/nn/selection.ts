import type { NeuralCandidate, RiskSummary, TrainingSample } from "./types";

/** Finds the largest strict cutoff accepting no score>=3 row in fitting or validation data. */
function cutoff(groups: Array<{ samples: TrainingSample[]; predictions: number[] }>): number {
  let threshold = 1;
  for (const { samples, predictions } of groups) {
    for (let i = 0; i < samples.length; i++) {
      if (!Number.isFinite(predictions[i])) throw new Error("Nonfinite NN prediction during cutoff selection.");
      if (samples[i].score >= 3) threshold = Math.min(threshold, predictions[i]);
    }
  }
  return threshold;
}

/** Counts exact accepted outcomes, preserving unavailable mean/worst when every row is rejected. */
function summarize(samples: TrainingSample[], predictions: number[], threshold: number): RiskSummary {
  let accepted = 0;
  let violations = 0;
  let sum = 0;
  let worst = 0;
  const counts: Record<string, number> = {};
  for (let i = 0; i < samples.length; i++) {
    if (predictions[i] >= threshold) continue;
    const score = samples[i].score;
    accepted++;
    sum += score;
    worst = Math.max(worst, score);
    if (score >= 3) violations++;
    counts[score] = (counts[score] ?? 0) + 1;
  }
  return { total: samples.length, accepted, violations, counts,
    avgScore: accepted ? sum / accepted : undefined, worstScore: accepted ? worst : undefined };
}

/** Maximizes validation acceptance, then favors lower accepted scores and higher fitting acceptance. */
function better(candidate: NeuralCandidate, previous: NeuralCandidate | undefined): boolean {
  if (!candidate.fit.accepted || !candidate.validation.accepted || candidate.fit.violations || candidate.validation.violations) return false;
  if (!previous) return true;
  return candidate.validation.accepted > previous.validation.accepted ||
    (candidate.validation.accepted === previous.validation.accepted && (
      candidate.validation.avgScore! < previous.validation.avgScore! ||
      (candidate.validation.avgScore === previous.validation.avgScore && (
        candidate.fit.accepted > previous.fit.accepted ||
        (candidate.fit.accepted === previous.fit.accepted && candidate.validationLoss < previous.validationLoss)
      ))
    ));
}

const selection = { better, cutoff, summarize } as const;
export default selection;
