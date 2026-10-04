import type { VolatilityPoint } from "@/lib/system/types";

export type VPointLetter = "B" | "T";

export interface VPointPredictionArm {
  /** Successor letter; absent while the source point is still the latest. */
  actual?: VPointLetter;
  /** Favorable excursion percent that fired the entry. */
  armedPct: number;
  id: string;
  lvl: number;
  maxDownPct?: number;
  maxUpPct?: number;
  pct: number;
  predicted: VPointLetter;
  /** Source point letter the excursion armed on. */
  source: VPointLetter;
  status: "failed" | "formed" | "missed" | "pending";
  symbol?: string;
  t: number;
}

export interface VPointPredictionDirection {
  accuracyPct?: number;
  /** Skipped — the predicted letter formed (winning entry missed). */
  fn: number;
  /** Entered — the opposite letter formed (losing entry). */
  fp: number;
  /** Entered — no successor emitted yet. */
  pending: number;
  predicted: VPointLetter;
  source: VPointLetter;
  /** Skipped — the opposite letter formed (losing entry avoided). */
  tn: number;
  /** Entered — the predicted letter formed. */
  tp: number;
}

export interface VPointPredictionResult {
  /** Entries the rule fired whose successor is missing or opposite. */
  arms: VPointPredictionArm[];
  directions: VPointPredictionDirection[];
  /** Skipped points where the predicted letter formed — winners left out. */
  misses: VPointPredictionArm[];
  /** In-range points evaluated. */
  evaluated: number;
  /** In-range points with no excursion data at all. */
  noData: number;
}

const DEFAULT_FAVORABLE_PCT = 3;
const DEFAULT_ADVERSE_PCT = 1;
const MINIMUM_PCT = 0;

/** Normalizes the favorable excursion percent that fires an entry. */
function normalizeFavorablePct(value: number): number {
  return Number.isFinite(value) && value >= MINIMUM_PCT
    ? value
    : DEFAULT_FAVORABLE_PCT;
}

/** Normalizes the adverse excursion percent that vetoes an entry. */
function normalizeAdversePct(value: number): number {
  return Number.isFinite(value) && value >= MINIMUM_PCT
    ? value
    : DEFAULT_ADVERSE_PCT;
}

/**
 * Replays saved point excursions against the emitted sequence as a binary
 * entry rule per direction: enter predicting BOTTOM when
 * `maxDownPct >= favorable && maxUpPct < adverse`, and predicting TOP with
 * the excursions swapped. TP/FP classify fired entries by the successor
 * letter; TN/FN classify skipped points the same way — FN is a winner the
 * rule left on the table. Pending entries are still the symbol's latest
 * point and stay out of the accuracy denominator.
 */
function compute(params: {
  adversePct: number;
  endTimeMs?: number;
  favorablePct: number;
  startTimeMs?: number;
  volatilityMap: Record<string, VolatilityPoint[]>;
}): VPointPredictionResult {
  const favorablePct = normalizeFavorablePct(params.favorablePct);
  const adversePct = normalizeAdversePct(params.adversePct);
  const directions = new Map<string, VPointPredictionDirection>();
  const arms: VPointPredictionArm[] = [];
  const misses: VPointPredictionArm[] = [];
  let evaluated = 0;
  let noData = 0;

  for (const [symbol, symbolPoints] of Object.entries(params.volatilityMap)) {
    const sorted = [...symbolPoints].sort((left, right) => left.t - right.t);
    for (let index = 0; index < sorted.length; index++) {
      const point = sorted[index];
      if (
        (params.startTimeMs !== undefined && point.t < params.startTimeMs) ||
        (params.endTimeMs !== undefined && point.t > params.endTimeMs)
      ) {
        continue;
      }
      evaluated += 1;

      if (
        !Number.isFinite(point.maxDownPct) &&
        !Number.isFinite(point.maxUpPct)
      ) {
        noData += 1;
        continue;
      }

      const successor = sorted[index + 1];
      for (const predicted of ["B", "T"] as const) {
        const favorable =
          predicted === "B" ? point.maxDownPct : point.maxUpPct;
        const adverse = predicted === "B" ? point.maxUpPct : point.maxDownPct;
        const fires =
          Number.isFinite(favorable) &&
          (favorable as number) >= favorablePct &&
          !(Number.isFinite(adverse) && (adverse as number) >= adversePct);
        const actual = successor?.l;
        const bucketFor = () => {
          const key = `${point.l}->${predicted}`;
          const existing = directions.get(key);
          if (existing) return existing;
          const created: VPointPredictionDirection = {
            fn: 0,
            fp: 0,
            pending: 0,
            predicted,
            source: point.l,
            tn: 0,
            tp: 0,
          };
          directions.set(key, created);
          return created;
        };

        if (fires) {
          const status = actual === undefined
            ? "pending"
            : actual === predicted
              ? "tp"
              : "fp";
          const bucket = bucketFor();
          bucket[status] += 1;
          arms.push({
            actual,
            armedPct: favorable as number,
            id: point.id,
            lvl: point.lvl,
            ...(Number.isFinite(point.maxDownPct)
              ? { maxDownPct: point.maxDownPct }
              : {}),
            ...(Number.isFinite(point.maxUpPct)
              ? { maxUpPct: point.maxUpPct }
              : {}),
            pct: point.pct,
            predicted,
            source: point.l,
            status:
              status === "tp"
                ? "formed"
                : status === "fp"
                  ? "failed"
                  : "pending",
            ...(point.symbol ?? symbol
              ? { symbol: point.symbol ?? symbol }
              : {}),
            t: point.t,
          });
          continue;
        }

        if (actual === undefined) {
          continue;
        }
        const bucket = bucketFor();
        if (actual === predicted) {
          bucket.fn += 1;
          misses.push({
            actual,
            armedPct: Number.isFinite(favorable)
              ? (favorable as number)
              : 0,
            id: point.id,
            lvl: point.lvl,
            ...(Number.isFinite(point.maxDownPct)
              ? { maxDownPct: point.maxDownPct }
              : {}),
            ...(Number.isFinite(point.maxUpPct)
              ? { maxUpPct: point.maxUpPct }
              : {}),
            pct: point.pct,
            predicted,
            source: point.l,
            status: "missed",
            ...(point.symbol ?? symbol
              ? { symbol: point.symbol ?? symbol }
              : {}),
            t: point.t,
          });
          continue;
        }
        bucket.tn += 1;
      }
    }
  }

  const ordered = [...directions.values()]
    .sort((left, right) =>
      `${left.source}${left.predicted}`.localeCompare(
        `${right.source}${right.predicted}`,
      ),
    )
    .map((bucket) => {
      const resolved = bucket.tp + bucket.fp + bucket.tn + bucket.fn;
      return {
        ...bucket,
        ...(resolved > 0
          ? { accuracyPct: ((bucket.tp + bucket.tn) / resolved) * 100 }
          : {}),
      };
    });

  arms.sort((left, right) => left.t - right.t);
  misses.sort((left, right) => left.t - right.t);

  return { arms, directions: ordered, evaluated, misses, noData };
}

const vPointPrediction = {
  adverse: {
    defaultValue: DEFAULT_ADVERSE_PCT,
    minimum: MINIMUM_PCT,
    normalize: normalizeAdversePct,
  },
  compute,
  favorable: {
    defaultValue: DEFAULT_FAVORABLE_PCT,
    minimum: MINIMUM_PCT,
    normalize: normalizeFavorablePct,
  },
};

export default vPointPrediction;
