/**
 * human_v1 signal math — pure reads over the feature store. No I/O, no
 * state writes; entry/exit/diagnostics share these so they never disagree.
 */
import type { RuntimeFeatures } from "@/lib/features/types";

/** Price side of the EMA: 1 above, -1 below, 0 exactly on it. */
export type EmaSide = 1 | -1 | 0;

/**
 * The EMA instance human_v1 trades against: `preferredId` when it still has
 * a definition (the id stored on an open position), else the first enabled
 * EMA in config order.
 */
function emaId(features: RuntimeFeatures | undefined, preferredId?: string): string | undefined {
  const defs = features?.defs ?? {};
  if (preferredId && defs[preferredId]?.type === "ema") return preferredId;
  return Object.values(defs).find((def) => def.type === "ema")?.id;
}

/** Mark price's side of the EMA value. */
function emaSide(markPrice: number, emaValue: number): EmaSide {
  if (markPrice > emaValue) return 1;
  if (markPrice < emaValue) return -1;
  return 0;
}

/**
 * Direction every captured Supertrend of the coin agrees on (1 up, -1
 * down), or undefined when there is none or they disagree.
 */
function supertrendConsensus(
  features: RuntimeFeatures | undefined,
  symbol: string,
): { direction?: 1 | -1; ids: string[] } {
  const readings = Object.entries(features?.coins[symbol]?.ind?.supertrend ?? {});
  const ids = readings.map(([id]) => id);
  if (readings.length === 0) return { ids };
  const first = readings[0][1].d;
  return readings.every(([, reading]) => reading.d === first)
    ? { direction: first, ids }
    : { ids };
}

/** One coin's current human_v1 reading. */
export interface HumanReading {
  emaId?: string;
  emaValue?: number;
  markPrice?: number;
  side?: EmaSide;
  /** Signed mark distance from the EMA, pct (positive = above). */
  distancePct?: number;
  /** Direction all Supertrends agree on; undefined when split or absent. */
  consensus?: 1 | -1;
  supertrendIds: string[];
  /** Why the coin cannot be evaluated yet (no EMA / mark / Supertrend). */
  missing?: string;
}

/** Reads the EMA side and Supertrend consensus for one coin. */
function read(
  features: RuntimeFeatures | undefined,
  symbol: string,
  markPrice: number | undefined,
  preferredEmaId?: string,
): HumanReading {
  const id = emaId(features, preferredEmaId);
  const consensus = supertrendConsensus(features, symbol);
  const reading: HumanReading = {
    consensus: consensus.direction,
    emaId: id,
    markPrice,
    supertrendIds: consensus.ids,
  };
  if (!id) return { ...reading, missing: "no EMA indicator configured" };
  const emaValue = features?.coins[symbol]?.ind?.ema?.[id]?.v;
  if (emaValue === undefined) return { ...reading, missing: `${id} has no reading yet` };
  if (markPrice === undefined || !Number.isFinite(markPrice)) {
    return { ...reading, emaValue, missing: "no mark price" };
  }
  if (consensus.ids.length === 0) {
    return { ...reading, emaValue, missing: "no Supertrend reading" };
  }
  return {
    ...reading,
    distancePct: ((markPrice - emaValue) / emaValue) * 100,
    emaValue,
    side: emaSide(markPrice, emaValue),
  };
}

const humanSignal = { emaId, emaSide, read, supertrendConsensus } as const;

export default humanSignal;
