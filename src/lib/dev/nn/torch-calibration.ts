import cutoff from "@/lib/strategies/default_with_features_gate/features/v3/cutoff";
import type { NeuralGateArtifact } from "@/lib/strategies/default_with_features_gate/features/v3";

import type { NeuralSample } from "./types";

interface RiskFold { symbol: string; calibration: number[]; holdout: number[]; risk: number[] }
const MIN_UNSAFE_GROUP = 10;

/** Fits a hierarchy of cutoffs with parent fallbacks; every held-out training row contributes to one safety margin. */
function hierarchical(samples: NeuralSample[], eligible: boolean[], folds: RiskFold[]) {
  const full = folds.find((fold) => fold.symbol === "ALL")!;
  const paths = samples.map((sample) => [...cutoff.path(sample.row.sequences[0], sample.row.feature, "hierarchical"), "ALL"]);
  const unsafe = (indices: number[], key: string) => indices.filter((i) => eligible[i] && samples[i].score >= 3 && paths[i].includes(key));
  const supported = ["ALL", ...cutoff.hierarchicalKeys.filter((key) => unsafe(full.calibration, key).length >= MIN_UNSAFE_GROUP)];
  const assigned = paths.map((path) => path.find((key) => supported.includes(key))!);
  const baselines = new Map<RiskFold, Record<string, number>>();
  for (const fold of folds) {
    const groups: Record<string, number> = {};
    for (const key of supported) {
      const points = unsafe(fold.calibration, key);
      if (key === "ALL" || points.length >= MIN_UNSAFE_GROUP) groups[key] = points.reduce((min, i) => Math.min(min, fold.risk[i]), 1);
    }
    if (Object.values(groups).some((value) => value <= 0)) throw new Error("Calibration has no positive unsafe cutoff.");
    baselines.set(fold, groups);
  }
  const held = folds.filter((fold) => fold.symbol !== "ALL").flatMap((fold) => {
    const base = baselines.get(fold)!;
    return fold.holdout.filter((i) => eligible[i]).map((i) => ({ i, key: assigned[i], ratio: fold.risk[i] / base[paths[i].find((key) => base[key] !== undefined)!] }));
  });
  const margins = Object.fromEntries(supported.map((key) => [key, held.reduce((min, point) => point.key === key && samples[point.i].score >= 3 ? Math.min(min, point.ratio) : min, 1) * 0.9]));
  const accepted = held.filter((point) => point.ratio < margins[point.key]);
  const base = baselines.get(full)!;
  const counts = Object.fromEntries(folds.filter((fold) => fold.symbol !== "ALL").map((fold) => [fold.symbol, accepted.filter((point) => samples[point.i].row.symbol === fold.symbol).length]));
  const selection = { margin: margins.ALL, margins, cutoffs: Object.fromEntries(supported.filter((key) => key !== "ALL").map((key) => [key, base[key] * margins[key]])),
    cutoffProfile: "hierarchical" as const, heldAccepted: accepted.length, heldTotal: samples.length,
    eligible: eligible.filter(Boolean).length, counts, threshold: base.ALL * margins.ALL };
  return { accepted: accepted.map((point) => point.i), selection, ...normalized(samples, eligible, full, held, selection) };
}

/** Calibrates frozen risk cutoffs using training folds only; sparse partitions retain the global fallback. */
function compute(samples: NeuralSample[], eligible: boolean[], folds: RiskFold[], grouped: boolean | "hierarchical" = false) {
  const full = folds.find((fold) => fold.symbol === "ALL");
  if (!full || eligible.length !== samples.length || folds.some((fold) => fold.risk.length !== samples.length || fold.risk.some((risk) => !Number.isFinite(risk) || risk < 0 || risk > 1))) throw new Error("Malformed calibration folds.");
  if (grouped === "hierarchical") return hierarchical(samples, eligible, folds);
  const keys = samples.map((sample) => cutoff.key(sample.row.sequences[0]));
  const groupUnsafe = (indices: number[], key: string) => indices.filter((i) => eligible[i] && samples[i].score >= 3 && keys[i] === key);
  const supported = grouped ? cutoff.keys.filter((key) => groupUnsafe(full.calibration, key).length >= MIN_UNSAFE_GROUP) : [];
  const baselines = new Map<RiskFold, { global: number; groups: Record<string, number> }>();
  for (const fold of folds) {
    const unsafe = fold.calibration.filter((i) => eligible[i] && samples[i].score >= 3);
    const global = unsafe.reduce((min, i) => Math.min(min, fold.risk[i]), 1);
    const groups = Object.fromEntries(supported.map((key) => {
      const points = groupUnsafe(fold.calibration, key);
      return [key, points.length >= MIN_UNSAFE_GROUP ? points.reduce((min, i) => Math.min(min, fold.risk[i]), 1) : global];
    }));
    if (global <= 0 || Object.values(groups).some((value) => value <= 0)) throw new Error("Calibration has no positive unsafe cutoff.");
    baselines.set(fold, { global, groups });
  }
  const held = folds.filter((fold) => fold.symbol !== "ALL").flatMap((fold) => {
    const base = baselines.get(fold)!;
    return fold.holdout.filter((i) => eligible[i]).map((i) => ({ i, key: keys[i], ratio: fold.risk[i] / (base.groups[keys[i]] ?? base.global) }));
  });
  const margin = held.reduce((min, point) => samples[point.i].score >= 3 ? Math.min(min, point.ratio) : min, 1) * 0.9;
  const margins = Object.fromEntries(supported.map((key) => [key, held.reduce((min, point) => point.key === key && samples[point.i].score >= 3 ? Math.min(min, point.ratio) : min, 1) * 0.9]));
  const accepted = held.filter((point) => point.ratio < (margins[point.key] ?? margin));
  const base = baselines.get(full)!;
  const cutoffs = grouped ? Object.fromEntries(supported.map((key) => [key, base.groups[key] * margins[key]])) as NeuralGateArtifact["cutoffs"] : undefined;
  const counts = Object.fromEntries(folds.filter((fold) => fold.symbol !== "ALL").map((fold) => [fold.symbol, accepted.filter((point) => samples[point.i].row.symbol === fold.symbol).length]));
  const selection = { margin, margins: grouped ? margins : undefined, cutoffs, cutoffProfile: undefined, heldAccepted: accepted.length, heldTotal: samples.length,
    eligible: eligible.filter(Boolean).length, counts, threshold: base.global * margin };
  return { accepted: accepted.map((point) => point.i), selection, ...normalized(samples, eligible, full, held, selection) };
}

/** Normalizes full/held-out predictions by each specialist's final, training-selected cutoff. */
function normalized(samples: NeuralSample[], eligible: boolean[], full: RiskFold, held: Array<{ i: number; key: string; ratio: number }>, selection: {
  threshold: number; cutoffs?: Record<string, number>; cutoffProfile?: "side-level" | "hierarchical"; margin: number; margins?: Record<string, number>;
}) {
  const heldRisk = samples.map(() => Infinity);
  for (const point of held) heldRisk[point.i] = point.ratio / (selection.margins?.[point.key] ?? selection.margin);
  const fullRisk = samples.map((sample, i) => eligible[i] ? full.risk[i] / cutoff.resolve(selection.threshold, selection.cutoffs,
    sample.row.sequences[0], sample.row.feature, selection.cutoffProfile).threshold : Infinity);
  return { heldRisk, fullRisk };
}

/** Returns compact selection statistics for logs and the portable artifact. */
function select(...args: Parameters<typeof compute>) { return compute(...args).selection; }

/** Returns accepted training-holdout indices for auditing unions of frozen specialists. */
function acceptedIndices(...args: Parameters<typeof compute>) { return compute(...args).accepted; }

/** Returns normalized training-only risks for selecting consensus across independently frozen specialists. */
function ranks(...args: Parameters<typeof compute>) {
  const { fullRisk, heldRisk } = compute(...args);
  return { fullRisk, heldRisk };
}

const calibration = { select, accepted: acceptedIndices, ranks } as const;
export default calibration;
