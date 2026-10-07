import inputs from "@/lib/strategies/default_with_features_gate/features/v3/inputs";
import type { FeatureGateDatasetRow } from "@/lib/dev/feature-gate";

import type { NeuralSample } from "./types";

/** Builds labeled training samples; neither outcomes nor future points enter the input vector. */
function prepare(rows: FeatureGateDatasetRow[], excludedSymbols: string[] = ["BTC"]): { samples: NeuralSample[]; skipped: number; anchors: number } {
  let skipped = 0;
  let anchors = 0;
  const samples: NeuralSample[] = [];
  for (const row of rows) {
    if (excludedSymbols.includes(row.symbol.toUpperCase().replace(/_USDT$/, ""))) { anchors++; continue; }
    const signal = row.sequences[0];
    if (!row.resolved || !Number.isInteger(row.missScore) || row.missScore! < 0 || row.t === undefined ||
        !signal || !inputs.valid(row.t, row.feature, { ...signal, symbol: row.symbol })) { skipped++; continue; }
    samples.push({ row, t: row.t, score: row.missScore!, raw: inputs.read(row.t, row.feature, { ...signal, symbol: row.symbol }) });
  }
  const starts = new Map<string, NeuralSample[]>();
  for (const sample of samples) {
    const group = starts.get(sample.row.symbol) ?? [];
    group.push(sample);
    starts.set(sample.row.symbol, group);
  }
  for (const group of starts.values()) group.sort((a, b) => a.row.sequences[0].t - b.row.sequences[0].t);
  for (const sample of samples) {
    const destinationT = sample.row.sequences.at(-1)?.t;
    if (sample.row.sequences.length < 2 || !Number.isFinite(destinationT)) continue;
    const group = starts.get(sample.row.symbol)!;
    let lo = 0;
    let hi = group.length;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (group[mid].row.sequences[0].t < destinationT!) lo = mid + 1;
      else hi = mid;
    }
    const next = group[lo];
    if (next && next.t > sample.t) sample.labelT = next.t;
  }
  return { samples: samples.sort((a, b) => a.t - b.t), skipped, anchors };
}

/** Chronological holdout with a time gap and purging of labels unavailable before the fitting boundary. */
function split(samples: NeuralSample[], validationFraction: number, gapMs: number) {
  if (samples.length < 10 || validationFraction <= 0 || validationFraction >= 0.5 || !Number.isFinite(gapMs) || gapMs < 0) {
    throw new Error("NN split needs at least 10 rows, a validation fraction in (0, 0.5), and a nonnegative gap.");
  }
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  const splitT = sorted[Math.floor(sorted.length * (1 - validationFraction))].t;
  const endT = splitT - gapMs;
  const fit = sorted.filter((sample) => sample.t < endT && sample.labelT !== undefined && sample.labelT < endT);
  const validation = sorted.filter((sample) => sample.t >= splitT);
  const purged = sorted.length - fit.length - validation.length;
  if (!fit.length || !validation.length) throw new Error("Chronological purging left an empty fitting or validation set.");
  if (!fit.some((sample) => sample.score >= 3) || !fit.some((sample) => sample.score < 3)) {
    throw new Error("Fitting set needs examples both below 3 and at/above 3.");
  }
  if (!validation.some((sample) => sample.score >= 3)) throw new Error("Validation has no score>=3 examples; a safe cutoff cannot be selected.");
  return { fit, validation, splitT, purged };
}

const dataset = { prepare, split } as const;
export default dataset;
