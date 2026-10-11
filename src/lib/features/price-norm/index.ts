import derive from "./derive";
import priceNormExhaustion from "./exhaustion";
import movementCorrelation from "./movement";
import {
  computePriceNormalized,
  isSameNormalizedValue,
  replayPriceNormalizedHistory,
} from "./normalized";
import { priceNormTrend } from "./trend";

/**
 * Pivot-envelope `priceNormalized` feature family: the reading, its
 * recorded trail, and the scores derived from that trail.
 */
const priceNorm = {
  /** Current envelope reading for a coin's pivots. */
  compute: computePriceNormalized,
  /** Next `priceNormalized` group (reading + trail + scores) for one coin. */
  derive,
  /** Direction-agnostic exhaustion score of a trail. */
  exhaustion: priceNormExhaustion,
  /** Quantized equality used for trail change detection. */
  isSame: isSameNormalizedValue,
  /** BTC ↔ coin trail movement correlation. */
  movement: movementCorrelation,
  /** Reconstructs a trail by replaying the pivot timeline. */
  replay: replayPriceNormalizedHistory,
  /** Kaufman efficiency-ratio trend score of a trail in [-1, 1]. */
  trend: priceNormTrend,
} as const;

export default priceNorm;
