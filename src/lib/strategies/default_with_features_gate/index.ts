import defaultDecision from "@/lib/precision/defaultDecision";
import type { RuntimeContext } from "@/lib/precision/types";

import type { StrategyAPI } from "../types";

/**
 * Returns the feature-gate refusal for one symbol at the current tick, or
 * undefined when the candidate may pass. An absent `management.featureGate`
 * config or an undefined `priceNormalized` (thin pivot history) means "no
 * opinion" and never blocks.
 */
function gateReason(
  context: RuntimeContext,
  symbol: string,
): string | undefined {
  const gate = context.state.config.management.featureGate;
  if (!gate) return undefined;
  const value =
    context.state.features?.coins[symbol.toUpperCase()]?.priceNormalized;
  if (value === undefined) return undefined;
  if (
    gate.minPriceNormalized !== undefined &&
    value < gate.minPriceNormalized
  ) {
    return (
      `priceNormalized ${value.toFixed(3)} is below the configured ` +
      `minimum ${gate.minPriceNormalized}`
    );
  }
  if (
    gate.maxPriceNormalized !== undefined &&
    value > gate.maxPriceNormalized
  ) {
    return (
      `priceNormalized ${value.toFixed(3)} is above the configured ` +
      `maximum ${gate.maxPriceNormalized}`
    );
  }
  return undefined;
}

/**
 * DEFAULT_WITH_FEATURES_GATE — the built-in default pipeline plus a
 * producer-level feature filter. Entry candidates still come from
 * `defaultDecision.entry.find` and still flow through the shared
 * eligibility/approval guard unchanged; this strategy only drops candidates
 * whose coin's `priceNormalized` sits outside `management.featureGate`
 * bounds, and explains the rejection through `diagnostics.explain` so the
 * dashboard shows a gated signal instead of a silent no-entry.
 *
 * Manual operator-forced entries are intentionally not gated (`shape` stays
 * omitted) — a manual entry is an explicit override.
 */
const defaultWithFeaturesGate: StrategyAPI = {
  name: "default_with_features_gate",
  decisions: {
    entry: {
      find: async (context) => {
        const candidates = await defaultDecision.entry.find(context);
        if (!context.state.config.management.featureGate) {
          return candidates;
        }
        return candidates.filter(
          (candidate) =>
            gateReason(context, candidate.symbol) === undefined,
        );
      },
    },
  },
  diagnostics: {
    explain: ({ context, symbol, decision }) => {
      if (!decision) return undefined;
      const reason = gateReason(context, symbol);
      if (!reason) return undefined;
      return {
        code: "FEATURE_GATE",
        reason: `Blocked by the feature gate: ${reason}.`,
        status: "blocked",
      };
    },
  },
};

export default defaultWithFeaturesGate;
