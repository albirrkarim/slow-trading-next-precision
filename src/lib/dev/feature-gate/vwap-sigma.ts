import datasetFilters from "./filters";
import type { FeatureGateDatasetRow } from "./types";

/** Which gate decisions a VWAP σ scatter includes. */
export type VwapSigmaView = "all" | "accepted" | "rejected";

/** One resolved row placed on the month-to-date × dSigma plane. */
export interface VwapSigmaPoint {
  /** Days since the monthly VWAP anchor at capture time. */
  day: number;
  dSigma: number;
  missScore: number;
  /** Signed vPoint level of the signal the row captured. */
  level?: number;
  symbol: string;
  t: number;
  accepted?: boolean;
}

/** Points split by missScore threshold: `correct` is score <= maxScore, `wrong` is above. */
export interface VwapSigmaSplit {
  correct: VwapSigmaPoint[];
  wrong: VwapSigmaPoint[];
  /** Resolved rows dropped for missing dSigma or VWAP anchor. */
  missing: number;
}

/**
 * Places resolved rows on month-to-date days (x) × VWAP dSigma (y) and
 * splits them at `maxScore`. `isAccepted` narrows to the requested view;
 * rows without a decision only appear in the "all" view.
 */
function split(
  rows: FeatureGateDatasetRow[],
  maxScore: number,
  view: VwapSigmaView = "all",
  isAccepted?: (row: FeatureGateDatasetRow) => boolean | undefined,
): VwapSigmaSplit {
  const result: VwapSigmaSplit = { correct: [], missing: 0, wrong: [] };
  for (const row of rows) {
    if (!row.resolved || row.missScore === undefined || row.t === undefined) continue;
    const accepted = isAccepted?.(row);
    if (view !== "all" && accepted !== (view === "accepted")) continue;
    const dSigma = datasetFilters.metrics.vwapDSigma.read(row);
    const day = datasetFilters.metrics.vwapMonthDay.read(row);
    if (typeof dSigma !== "number" || !Number.isFinite(dSigma) || day === undefined) {
      result.missing += 1;
      continue;
    }
    const point: VwapSigmaPoint = { accepted, day, dSigma, level: row.sequences[0]?.lvl, missScore: row.missScore, symbol: row.symbol, t: row.t };
    (row.missScore <= maxScore ? result.correct : result.wrong).push(point);
  }
  return result;
}

const vwapSigma = { split } as const;

export default vwapSigma;
