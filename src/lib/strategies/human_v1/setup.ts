/**
 * human_v1 setups — pure rules over one coin's reading. No I/O, no state.
 *
 * Both setups need every Supertrend to have flipped the same way within
 * `HUMAN_V1_FLIP_WINDOW_MS` of each other, the newest flip no older than
 * that window, at least two Supertrend lines touching (within
 * `HUMAN_V1_COLLIDE_PCT` of price — they "collide" on the chart), and the
 * mark above the EMA — for LONG (all up) and SHORT (all down) alike.
 * SL sits at the slowest Supertrend line (the one farthest from price), TP
 * at `HUMAN_V1_TP_R` times that risk. Research over 16 coins × 3 years
 * (2023-10 → 2026-10) put this at ~48% wins / +0.42R per trade, versus
 * −0.15R for the earlier EMA/VWAP-band exits.
 */
import type { PositionPlan } from "@/lib/system/trading/types";

import type { HumanReading } from "./signal";

/** Max time between the first and last Supertrend flip, and max age of the last flip. */
export const HUMAN_V1_FLIP_WINDOW_MS = 24 * 60 * 60_000;
/** Max gap between the two closest Supertrend lines for them to "collide", % of the mark. */
export const HUMAN_V1_COLLIDE_PCT = 1.25;
/** TP distance from entry as a multiple of the entry→SL risk. */
export const HUMAN_V1_TP_R = 2;

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

/** Smallest gap between any two line prices, as % of `price`. */
function closestGapPct(lines: number[], price: number): number {
  const sorted = [...lines].sort((a, b) => a - b);
  let gap = Infinity;
  for (let i = 1; i < sorted.length; i += 1) gap = Math.min(gap, sorted[i] - sorted[i - 1]);
  return (gap / price) * 100;
}

/** Evaluates both setups for one coin at `now`; the reason explains a miss. */
function evaluate(reading: HumanReading, now: number): HumanSetupResult {
  if (reading.missing) return { reason: reading.missing };
  const { supertrend } = reading;
  const markPrice = reading.markPrice as number;
  const emaValue = reading.emaValue as number;
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
  // BOTH:HUMAN_V1_ENTRY — at least two Supertrend lines collide.
  const gapPct = closestGapPct(supertrend.lines, markPrice);
  if (!(gapPct <= HUMAN_V1_COLLIDE_PCT)) {
    return { reason: `closest Supertrend lines ${gapPct.toFixed(2)}% apart, need ≤ ${HUMAN_V1_COLLIDE_PCT}% to collide` };
  }
  if (reading.side !== 1) return { reason: `price is not above ${reading.emaId}` };

  // BOTH:HUMAN_V1_ENTRY — SL at the slowest line, TP at 2R.
  const direction = supertrend.direction;
  const sl = direction === 1 ? Math.min(...supertrend.lines) : Math.max(...supertrend.lines);
  const risk = direction * (markPrice - sl);
  if (!(risk > 0)) return { reason: `price is not beyond the slowest Supertrend line ${sl}` };
  const tp = markPrice + direction * HUMAN_V1_TP_R * risk;
  return { setup: { direction, emaValue, flipT: supertrend.flipT, markPrice, plan: { sl, tp } } };
}

const humanSetup = { evaluate } as const;

export default humanSetup;
