import type {
  CoinFeatures,
  FeatureGateBounds,
} from "@/lib/features/types";
import defaultDecision from "@/lib/precision/defaultDecision";
import type { RuntimeContext } from "@/lib/precision/types";

import type { StrategyAPI } from "../types";

/**
 * Bounds this strategy enforces on the `priceNormalized` feature —
 * strategy-owned policy, deliberately hardcoded here instead of living in
 * settings so the gate can grow richer rules (e.g. the history excursion
 * check below) without config plumbing.
 *
 * - Coin zone `[0.2, 0.8]`: below 0.2 the candidate's latest pivot scraped
 *   the 2-month envelope floor (breakdown risk); above 0.8 it formed near
 *   the top (chasing).
 * - BTC zone `[0.3, 0.8]`: a market-context veto applied to EVERY
 *   candidate — BTC is always tracked in `state.vPointsMap` as the
 *   volatility anchor even when it is not a traded symbol, so below 0.3
 *   means the market is breaking down and above 0.8 means it is extended.
 *
 * Both bounds apply to the whole `priceNormalizedHistory` trail (rolling
 * 10-day window), not just the current value — a coin that recently
 * touched outside its zone is rejected even when it has since moved back
 * inside.
 */
export const FEATURE_GATE_BOUNDS: Required<FeatureGateBounds> = {
  btcMaxPriceNormalized: 0.8,
  btcMinPriceNormalized: 0.3,
  maxPriceNormalized: 0.8,
  minPriceNormalized: 0.3,
};

/** Compact date tag for gate messages, e.g. " on 2026-09-25". */
function formatDayTag(t?: number): string {
  return t === undefined
    ? ""
    : ` on ${new Date(t).toISOString().slice(0, 10)}`;
}

/**
 * Returns the freshest `priceNormalized` sample outside `[min, max]`,
 * scanning the current value first then the history trail newest-to-oldest.
 * Absent values are "no opinion" — never a violation.
 */
function outsideBounds(
  coin: CoinFeatures | undefined,
  min: number,
  max: number,
): { p: number; t?: number } | undefined {
  if (!coin) return undefined;
  const current = coin.priceNormalized;
  if (current !== undefined && (current < min || current > max)) {
    return { p: current };
  }

  for (const { p, t } of [...coin.priceNormalizedHistory].reverse()) {
    if (p < min || p > max) return { p, t };
  }
  return undefined;
}

/**
 * Returns the feature-gate refusal for one symbol at the current tick, or
 * undefined when the candidate may pass. Checks the BTC market-context
 * bound first, then the candidate coin's own bound — each across its whole
 * 10-day history trail. An undefined `priceNormalized` (thin pivot
 * history) means "no opinion" — never a block.
 */
function gateReason(
  context: RuntimeContext,
  symbol: string,
): string | undefined {
  const bounds = FEATURE_GATE_BOUNDS;

  const btcViolation = outsideBounds(
    context.state.features?.coins.BTC,
    bounds.btcMinPriceNormalized,
    bounds.btcMaxPriceNormalized,
  );
  if (btcViolation) {
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
  );
  if (coinViolation) {
    return (
      `priceNormalized ${coinViolation.p.toFixed(3)}` +
      `${formatDayTag(coinViolation.t)} is outside the gate zone ` +
      `${bounds.minPriceNormalized}–${bounds.maxPriceNormalized}`
    );
  }
  return undefined;
}

/**
 * DEFAULT_WITH_FEATURES_GATE — the built-in default pipeline plus a
 * producer-level feature filter. Entry candidates still come from
 * `defaultDecision.entry.find` and still flow through the shared
 * eligibility/approval guard unchanged; this strategy only drops candidates
 * violating `FEATURE_GATE_BOUNDS` — any `priceNormalizedHistory` sample
 * outside the zone within the rolling 10-day trail counts as a violation,
 * not just the current value (BTC context veto first, then the coin's own
 * envelope zone) — and explains the rejection through
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
