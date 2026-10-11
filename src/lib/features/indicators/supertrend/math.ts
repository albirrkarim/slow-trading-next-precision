/**
 * Supertrend indicator — TradingView `ta.supertrend` semantics, folded one
 * closed candle at a time so the runtime feed and the chart share it.
 * Pure math; no I/O.
 */

import type { FoldCandle } from "../types";
import type {
  CoinSupertrend,
  SupertrendAccumulator,
  SupertrendFeatureConfig,
} from "./types";

type Params = Pick<SupertrendFeatureConfig, "atrLength" | "factor">;

/** Fresh state; starts in a downtrend like Pine until ATR exists. */
function create(): SupertrendAccumulator {
  return { atr: 0, d: -1, fT: 0, lb: 0, n: 0, pc: 0, t: 0, tr: 0, ub: 0 };
}

/**
 * Folds one closed candle:
 * - true range (first candle: high − low), ATR = Wilder RMA seeded with the
 *   SMA of the first `atrLength` true ranges;
 * - basic bands `hl2 ± factor × ATR`, ratcheted: the lower band only rises
 *   (unless the previous close broke below it), the upper band only falls
 *   (unless the previous close broke above it);
 * - direction: down until the previous candle had an ATR; from a downtrend
 *   flip up when close > upper band, from an uptrend flip down when close <
 *   lower band. `fT` records the flip candle.
 */
function fold(
  acc: SupertrendAccumulator,
  candle: FoldCandle,
  { atrLength, factor }: Params,
): void {
  const { high, low, close } = candle;
  if (!Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) {
    return;
  }
  const trueRange =
    acc.n === 0
      ? high - low
      : Math.max(high - low, Math.abs(high - acc.pc), Math.abs(low - acc.pc));
  const prevHadAtr = acc.n >= atrLength;
  acc.n += 1;
  acc.t = candle.t;

  if (acc.n < atrLength) {
    acc.tr += trueRange;
    acc.pc = close;
    return;
  }
  acc.atr =
    acc.n === atrLength
      ? (acc.tr + trueRange) / atrLength
      : (acc.atr * (atrLength - 1) + trueRange) / atrLength;

  const hl2 = (high + low) / 2;
  const basicUpper = hl2 + factor * acc.atr;
  const basicLower = hl2 - factor * acc.atr;
  // Pine `nz()` — the first band compares against 0.
  const lower =
    basicLower > acc.lb || acc.pc < acc.lb ? basicLower : acc.lb;
  const upper =
    basicUpper < acc.ub || acc.pc > acc.ub || acc.ub === 0
      ? basicUpper
      : acc.ub;

  let direction: 1 | -1;
  if (!prevHadAtr) direction = -1;
  else if (acc.d === -1) direction = close > upper ? 1 : -1;
  else direction = close < lower ? -1 : 1;

  if (prevHadAtr && direction !== acc.d) acc.fT = candle.t;
  acc.d = direction;
  acc.ub = upper;
  acc.lb = lower;
  acc.pc = close;
}

/** Current line: lower band in an uptrend, upper band in a downtrend. */
function line(acc: SupertrendAccumulator): number {
  return acc.d === 1 ? acc.lb : acc.ub;
}

/** True once ATR exists and the line is meaningful. */
function ready(acc: SupertrendAccumulator, { atrLength }: Params): boolean {
  return acc.n >= atrLength && line(acc) > 0;
}

/**
 * Coin-facing reading: direction, line (5 significant digits), mark
 * distance pct (0.1 steps), and the flip time. Undefined during warm-up.
 */
function derive(
  acc: SupertrendAccumulator | undefined,
  params: Params,
  markPrice?: number,
): CoinSupertrend | undefined {
  if (!acc || !ready(acc, params)) return undefined;
  const value = line(acc);
  const reading: CoinSupertrend = {
    d: acc.d,
    l: Number(value.toPrecision(5)),
  };
  if (typeof markPrice === "number" && Number.isFinite(markPrice)) {
    reading.dPct = Number((((markPrice - value) / value) * 100).toFixed(1));
  }
  if (acc.fT > 0) reading.fT = acc.fT;
  return reading;
}

const supertrend = {
  accumulator: { create, fold },
  derive,
  line,
  ready,
} as const;

export default supertrend;
