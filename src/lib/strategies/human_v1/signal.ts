/**
 * human_v1 signal math — pure reads over the feature store. No I/O, no
 * state writes; entry and diagnostics share these so they never disagree.
 */
import indicators from "@/lib/features/indicators";
import type { RuntimeFeatures } from "@/lib/features/types";

/** Price side of the EMA: 1 above, -1 below, 0 exactly on it. */
export type EmaSide = 1 | -1 | 0;

/** The first enabled EMA instance in config order. */
function emaId(features: RuntimeFeatures | undefined): string | undefined {
  return Object.values(features?.defs ?? {}).find((def) => def.type === "ema")?.id;
}

/** Mark price's side of the EMA value. */
function emaSide(markPrice: number, emaValue: number): EmaSide {
  if (markPrice > emaValue) return 1;
  if (markPrice < emaValue) return -1;
  return 0;
}

/** Every captured Supertrend of a coin, read together. */
export interface SupertrendAlignment {
  /** Direction all Supertrends agree on; undefined when split or absent. */
  direction?: 1 | -1;
  ids: string[];
  /** Newest flip time (ms) among them — when the alignment completed. */
  flipT?: number;
  /** Time between the oldest and newest flip, ms. */
  spreadMs?: number;
  /** Every Supertrend's line price. */
  lines: number[];
}

/**
 * Direction every Supertrend of the coin agrees on, plus how closely their
 * flips line up in time. Flip timing is absent when any reading lacks `fT`.
 */
function supertrendAlignment(features: RuntimeFeatures | undefined, symbol: string): SupertrendAlignment {
  const readings = Object.entries(features?.coins[symbol]?.ind?.supertrend ?? {});
  const ids = readings.map(([id]) => id);
  const lines = readings.map(([, reading]) => reading.l);
  if (readings.length === 0) return { ids, lines };
  const first = readings[0][1].d;
  if (!readings.every(([, reading]) => reading.d === first)) return { ids, lines };
  const flips = readings.map(([, reading]) => reading.fT ?? 0);
  if (flips.some((t) => !(t > 0))) return { direction: first, ids, lines };
  const flipT = Math.max(...flips);
  return { direction: first, flipT, ids, lines, spreadMs: flipT - Math.min(...flips) };
}

/** One coin's current human_v1 reading. */
export interface HumanReading {
  emaId?: string;
  emaValue?: number;
  markPrice?: number;
  side?: EmaSide;
  supertrend: SupertrendAlignment;
  /** Why the coin cannot be evaluated yet (no EMA / mark / Supertrend). */
  missing?: string;
}

/** Reads the EMA side and Supertrend alignment for one coin. */
function read(
  features: RuntimeFeatures | undefined,
  symbol: string,
  markPrice: number | undefined,
): HumanReading {
  const coin = features?.coins[symbol];
  const id = emaId(features);
  const supertrend = supertrendAlignment(features, symbol);
  const reading: HumanReading = { emaId: id, markPrice, supertrend };
  if (!id) return { ...reading, missing: "no EMA indicator configured" };
  const emaValue = indicators.read.ema(coin, id)?.v;
  if (emaValue === undefined) return { ...reading, missing: `${id} has no reading yet` };
  if (markPrice === undefined || !Number.isFinite(markPrice)) {
    return { ...reading, emaValue, missing: "no mark price" };
  }
  if (supertrend.ids.length === 0) {
    return { ...reading, emaValue, missing: "no Supertrend reading" };
  }
  return { ...reading, emaValue, side: emaSide(markPrice, emaValue) };
}

const humanSignal = { emaId, emaSide, read, supertrendAlignment } as const;

export default humanSignal;
