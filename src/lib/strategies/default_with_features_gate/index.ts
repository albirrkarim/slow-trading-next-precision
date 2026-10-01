import type { FeatureGateBounds } from "@/lib/features/types";
import defaultDecision from "@/lib/precision/defaultDecision";
import type { RuntimeContext } from "@/lib/precision/types";

import type { StrategyAPI } from "../types";

/**
 * Bounds this strategy enforces on the `priceNormalized` feature —
 * strategy-owned policy, deliberately hardcoded here instead of living in
 * settings so the gate can grow richer rules (e.g. `priceNormalizedHistory`
 * sustained-excursion checks) without config plumbing.
 *
 * - Coin zone `[0.2, 0.8]`: below 0.2 the candidate's latest pivot scraped
 *   the 2-month envelope floor (breakdown risk); above 0.8 it formed near
 *   the top (chasing).
 * - BTC zone `[0.3, 0.8]`: a market-context veto applied to EVERY
 *   candidate — BTC is always tracked in `state.vPointsMap` as the
 *   volatility anchor even when it is not a traded symbol, so below 0.3
 *   means the market is breaking down and above 0.8 means it is extended.
 */
export const FEATURE_GATE_BOUNDS: Required<FeatureGateBounds> = {
  btcMaxPriceNormalized: 0.8,
  btcMinPriceNormalized: 0.3,
  maxPriceNormalized: 0.8,
  minPriceNormalized: 0.2,
};

/**
 * Returns the feature-gate refusal for one symbol at the current tick, or
 * undefined when the candidate may pass. Checks the BTC market-context
 * bound first, then the candidate coin's own bound. An undefined
 * `priceNormalized` (thin pivot history) means "no opinion" — never a
 * block.
 */
function gateReason(
  context: RuntimeContext,
  symbol: string,
): string | undefined {
  const bounds = FEATURE_GATE_BOUNDS;

  const btc = context.state.features?.coins.BTC?.priceNormalized;
  if (btc !== undefined) {
    if (btc < bounds.btcMinPriceNormalized) {
      return (
        `BTC priceNormalized ${btc.toFixed(3)} is below the BTC gate ` +
        `floor ${bounds.btcMinPriceNormalized}`
      );
    }
    if (btc > bounds.btcMaxPriceNormalized) {
      return (
        `BTC priceNormalized ${btc.toFixed(3)} is above the BTC gate ` +
        `ceiling ${bounds.btcMaxPriceNormalized}`
      );
    }
  }

  const value =
    context.state.features?.coins[symbol.toUpperCase()]?.priceNormalized;
  if (value === undefined) return undefined;
  if (value < bounds.minPriceNormalized) {
    return (
      `priceNormalized ${value.toFixed(3)} is below the gate ` +
      `floor ${bounds.minPriceNormalized}`
    );
  }
  if (value > bounds.maxPriceNormalized) {
    return (
      `priceNormalized ${value.toFixed(3)} is above the gate ` +
      `ceiling ${bounds.maxPriceNormalized}`
    );
  }
  return undefined;
}

/**
 * DEFAULT_WITH_FEATURES_GATE — the built-in default pipeline plus a
 * producer-level feature filter. Entry candidates still come from
 * `defaultDecision.entry.find` and still flow through the shared
 * eligibility/approval guard unchanged; this strategy only drops candidates
 * violating `FEATURE_GATE_BOUNDS` (BTC context veto first, then the coin's
 * own envelope zone) and explains the rejection through
 * `diagnostics.explain` so the dashboard shows a gated signal instead of a
 * silent no-entry.
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
