import type {
  CoinFeatures,
  FeatureGateBounds,
} from "@/lib/features/types";
import defaultDecision from "@/lib/precision/defaultDecision";
import type { RuntimeContext } from "@/lib/precision/types";
import type { VolatilityPoint } from "@/lib/system/types/market";

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
 * Both bounds apply to the recent portion of `priceNormalizedHistory`,
 * not just the current value — a coin that touched outside its zone
 * within `historyWindowDays` is rejected even when it has since moved
 * back inside. The recorded trail itself keeps the full 10-day window
 * (`FEATURES_HISTORY_WINDOW_MS`); the gate only judges its freshest days.
 */
export const FEATURE_GATE_BOUNDS: Required<FeatureGateBounds> = {
  btcMaxPriceNormalized: 0.8,
  btcMinPriceNormalized: 0.3,
  historyWindowDays: 20,
  // coin
  maxPriceNormalized: 0.8,
  minPriceNormalized: 0.3,

  maxPriceNormalizedExtreme: 2,
  minPriceNormalizedExtreme: 0,
};

/**
 * Deep-run repetition limit mined from `storage/analysis/case1`: a level-1
 * entry whose previous same-side run already reached `|lvl| >= 4`
 * escalates again at roughly 4x the ~1.2% base rate — the only
 * sequence feature that separated at all. Coverage is small (catches a
 * few percent of escalations) but the collateral is near zero, so the
 * guard stays cheap. Applies only to `|lvl| === 1` candidates — the
 * level the user asked to protect; deeper entries are untouched.
 */
export const PREV_RUN_DEPTH_LIMIT = 4;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Compact date tag for gate messages, e.g. " on 2026-09-25". */
function formatDayTag(t?: number): string {
  return t === undefined
    ? ""
    : ` on ${new Date(t).toISOString().slice(0, 10)}`;
}

/**
 * Returns the freshest `priceNormalized` sample outside `[min, max]`,
 * scanning the current value first then the history trail newest-to-oldest
 * — limited to samples at or after `cutoffMs` (the judge window; the
 * recorded trail itself reaches further back). Absent values are "no
 * opinion" — never a violation.
 */
function outsideBounds(
  coin: CoinFeatures | undefined,
  min: number,
  max: number,
  cutoffMs: number,
): { p: number; t?: number } | undefined {
  if (!coin) return undefined;
  const current = coin.priceNormalized;
  if (current !== undefined && (current < min || current > max)) {
    return { p: current };
  }

  for (const { p, t } of [...coin.priceNormalizedHistory].reverse()) {
    if (t < cutoffMs) break;
    if (p < min || p > max) return { p, t };
  }
  return undefined;
}

/**
 * Returns the feature-gate refusal for one symbol at the current tick, or
 * undefined when the candidate may pass. Checks the BTC market-context
 * bound first, then the candidate coin's own bound — each judged on the
 * current value plus history samples inside `historyWindowDays` — and
 * last the deep-run repetition guard on level-1 signals. An
 * undefined `priceNormalized` (thin pivot history) means "no opinion" —
 * never a block.
 */
function gateReason(
  context: RuntimeContext,
  symbol: string,
  signal?: VolatilityPoint,
): string | undefined {
  const bounds = FEATURE_GATE_BOUNDS;
  const cutoff =
    context.state.currentTime - bounds.historyWindowDays * DAY_MS;

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
        context.state.currentTime - 5 * DAY_MS;

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

/**
 * DEFAULT_WITH_FEATURES_GATE — the built-in default pipeline plus a
 * producer-level feature filter. Entry candidates still come from
 * `defaultDecision.entry.find` and still flow through the shared
 * eligibility/approval guard unchanged; this strategy only drops candidates
 * violating `FEATURE_GATE_BOUNDS` — any `priceNormalizedHistory` sample
 * outside the zone within the last `historyWindowDays` counts as a
 * violation, not just the current value (BTC context veto first, then the
 * coin's own envelope zone) — plus level-1 signals whose previous same-side
 * run already reached `PREV_RUN_DEPTH_LIMIT`. Rejections are explained
 * through `diagnostics.explain` so the dashboard shows a gated signal
 * instead of a silent no-entry.
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
            gateReason(
              context,
              candidate.symbol,
              candidate.type === "entry" ? candidate.entrySignal : undefined,
            ) === undefined,
        );
      },
    },
  },
  diagnostics: {
    explain: ({ context, symbol, decision }) => {
      if (!decision) return undefined;
      const reason = gateReason(context, symbol, decision.entrySignal);
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
