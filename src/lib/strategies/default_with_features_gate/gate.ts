import type { RuntimeContext } from "@/lib/precision/types";
import { windowsMs } from "@/lib/system/constants";
import type { VolatilityPoint } from "@/lib/system/types/market";
import { FEATURE_GATE_BOUNDS } from "./constants";
import { formatDayTag, outsideBounds } from "./utils";

/**
 * Returns the feature-gate refusal for one symbol at the current tick, or
 * undefined when the candidate may pass. Checks the BTC market-context
 * bound first, then the candidate coin's own bound — each judged on the
 * current value plus history samples inside `historyWindowDays` — and
 * last the deep-run repetition guard on level-1 signals. An
 * undefined `priceNormalized` (thin pivot history) means "no opinion" —
 * never a block.
 */
export function gateReason(
  context: RuntimeContext,
  symbol: string,
  signal?: VolatilityPoint,
): string | undefined {
  const bounds = FEATURE_GATE_BOUNDS;
  const cutoff =
    context.state.currentTime - bounds.historyWindowDays * windowsMs["1d"];

  const btcViolation = outsideBounds(
    context.state.features?.coins.BTC,
    bounds.btcMinPriceNormalized,
    bounds.btcMaxPriceNormalized,
    cutoff,
  );
  if (btcViolation && Math.abs(signal?.lvl ?? 0) < 3) {
    return (
      `BTC priceNormalized ${btcViolation.p.toFixed(3)}` +
      `${formatDayTag(btcViolation.t)} is outside the BTC gate zone ` +
      `${bounds.btcMinPriceNormalized}–${bounds.btcMaxPriceNormalized}`
    );
  }

  const coinViolation = outsideBounds(
    context.state.features?.coins[symbol.toUpperCase()],
    bounds.minPriceNormalized,
    bounds.maxPriceNormalized,
    cutoff,
  );

  if (coinViolation) {
    if (Math.abs(signal?.lvl ?? 0) < 3) {
      return (
        `priceNormalized ${coinViolation.p.toFixed(3)}` +
        `${formatDayTag(coinViolation.t)} is outside the gate zone ` +
        `${bounds.minPriceNormalized}–${bounds.maxPriceNormalized}`
      );
    } else {

      const cutoffExtreme =
        context.state.currentTime - 5 * windowsMs["1d"];

      const coinViolationExtreme = outsideBounds(
        context.state.features?.coins[symbol.toUpperCase()],
        bounds.minPriceNormalizedExtreme,
        bounds.maxPriceNormalizedExtreme,
        cutoffExtreme,
      );

      if (coinViolationExtreme && Math.abs(signal?.lvl ?? 0) < 5) {
        return (
          `priceNormalized ${coinViolationExtreme.p.toFixed(3)}` +
          `${formatDayTag(coinViolationExtreme.t)} is outside the extreme gate zone ` +
          `${bounds.minPriceNormalizedExtreme}–${bounds.maxPriceNormalizedExtreme}`
        );
      }
    }
  }

  return undefined;
}