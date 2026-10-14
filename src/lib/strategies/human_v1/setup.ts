/**
 * human_v1 setups — pure rules over one coin's reading. No I/O, no state.
 *
 * Both setups need every Supertrend to have flipped the same way within
 * `HUMAN_V1_FLIP_WINDOW_MS` of each other (the flips line up vertically on
 * the chart), the newest flip no older than that window, and the mark
 * above the EMA:
 * - LONG (all up): SL at the EMA, TP at monthly VWAP + 1.5σ.
 * - SHORT (all down, still above the EMA): SL at VWAP + 1σ, TP at
 *   VWAP − 1.5σ, which must sit below the EMA.
 */
import type { PositionPlan } from "@/lib/system/trading/types";

import type { HumanReading } from "./signal";

/** Max time between the first and last Supertrend flip, and max age of the last flip. */
export const HUMAN_V1_FLIP_WINDOW_MS = 24 * 60 * 60_000;
/** TP distance from the monthly VWAP, in σ. */
export const HUMAN_V1_TP_SIGMA = 1.5;
/** SHORT SL distance above the monthly VWAP, in σ. */
export const HUMAN_V1_SHORT_SL_SIGMA = 1;

/** A tradable setup: direction, exit plan, and the alignment it consumes. */
export interface HumanSetup {
  direction: 1 | -1;
  plan: Required<Pick<PositionPlan, "tp" | "sl">>;
  /** Newest Supertrend flip — each alignment is traded at most once. */
  flipT: number;
  markPrice: number;
  emaValue: number;
}

export type HumanSetupResult = { setup: HumanSetup } | { reason: string };

/** "6h", "1d 2h" — span for diagnostics. */
function hours(ms: number): string {
  const total = Math.round(ms / 3_600_000);
  return total >= 24 ? `${Math.floor(total / 24)}d ${total % 24}h` : `${total}h`;
}

/** Evaluates both setups for one coin at `now`; the reason explains a miss. */
function evaluate(reading: HumanReading, now: number): HumanSetupResult {
  if (reading.missing) return { reason: reading.missing };
  const { supertrend } = reading;
  const markPrice = reading.markPrice as number;
  const emaValue = reading.emaValue as number;
  const vwap = reading.vwap as number;
  const sigma = reading.sigma as number;
  const ids = supertrend.ids.join(", ");

  if (supertrend.direction === undefined) return { reason: `Supertrends disagree (${ids})` };
  if (supertrend.flipT === undefined || supertrend.spreadMs === undefined) {
    return { reason: `Supertrend flip times unknown (${ids})` };
  }
  if (supertrend.spreadMs > HUMAN_V1_FLIP_WINDOW_MS) {
    return { reason: `Supertrends flipped ${hours(supertrend.spreadMs)} apart, max ${hours(HUMAN_V1_FLIP_WINDOW_MS)}` };
  }
  const age = now - supertrend.flipT;
  if (age > HUMAN_V1_FLIP_WINDOW_MS) {
    return { reason: `alignment is ${hours(age)} old, max ${hours(HUMAN_V1_FLIP_WINDOW_MS)}` };
  }
  if (reading.side !== 1) return { reason: `price is not above ${reading.emaId}` };

  if (supertrend.direction === 1) {
    // BOTH:HUMAN_V1_ENTRY — LONG: SL at the EMA, TP at VWAP + 1.5σ.
    const tp = vwap + HUMAN_V1_TP_SIGMA * sigma;
    if (tp <= markPrice) return { reason: `price already past VWAP +${HUMAN_V1_TP_SIGMA}σ ${tp}` };
    return { setup: { direction: 1, emaValue, flipT: supertrend.flipT, markPrice, plan: { sl: emaValue, tp } } };
  }

  // BOTH:HUMAN_V1_ENTRY — SHORT from above the EMA: SL at VWAP + 1σ,
  // TP at VWAP − 1.5σ, which must lie below the EMA.
  const tp = vwap - HUMAN_V1_TP_SIGMA * sigma;
  const sl = vwap + HUMAN_V1_SHORT_SL_SIGMA * sigma;
  if (tp >= emaValue) return { reason: `VWAP −${HUMAN_V1_TP_SIGMA}σ ${tp} is not below ${reading.emaId} ${emaValue}` };
  if (sl <= markPrice) return { reason: `price already above VWAP +${HUMAN_V1_SHORT_SL_SIGMA}σ ${sl}` };
  return { setup: { direction: -1, emaValue, flipT: supertrend.flipT, markPrice, plan: { sl, tp } } };
}

const humanSetup = { evaluate } as const;

export default humanSetup;
