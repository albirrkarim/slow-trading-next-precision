import type { RuntimeFeatures } from "@/lib/features/types";
import type { FeatureGateResult } from "@/lib/strategies/feature-gates";
import type { VolatilityPoint } from "@/lib/system/types/market";
import featureGateRegimes from "./regimes";
import { closeToExtreme, isCurrentExtreme } from "./price_norm";
import { vwapFilter } from "./vwap";

/**
 * Bounds this strategy enforces on the monthly-anchored VWAP feature —
 * strategy-owned policy, deliberately hardcoded here instead of living in
 * settings (same stance as `FEATURE_GATE_BOUNDS` in v1).
 *
 * - `minStretchPct`: the monthly envelope (±2σ) must span at least this
 *   share of the VWAP. Ties the gate to the strategy's own physics — the
 *   volatility rail only trades ~5% cycles, so an envelope narrower than
 *   5% has no room for a mean-reversion leg.
 * - `minSigma`/`maxSigma`: the signal's distance from the VWAP must sit
 *   inside `[1σ, 2σ]` — stretched enough to mean-revert, not so extreme
 *   it becomes a falling knife.
 * - `maxSignalAgeMs`: reject signals older than 12h — stretched points
 *   must be fresh; an aging vPoint can slide into the σ zone without
 *   representing a new stretched entry.
 */
export const FEATURE_GATE_VWAP_BOUNDS = {
    minStretchPct: 6,
    minSigma: 1.2,
    maxSigma: 1.7,
    // 5y backtest (726 trades): 7/16 losers vs 59/710 winners entered on
    // a vPoint >12h old; tightening from 24h nets ≈ +426 USDT, positive in
    // both halves of the run.
    maxSignalAgeMs: 12 * 60 * 60 * 1000,
    // First 2 days of the UTC month: the anchor just reset, so stdev rests
    // on too few candles — the σ envelope is thin and unstable.
    blockAfterMonthStartMs: 2 * 24 * 60 * 60 * 1000,
    // Last 2 days of the UTC month: the VWAP anchor is about to reset, so
    // an entry opened now loses the envelope it was judged on within ~48h.
    blockBeforeMonthEndMs: 2 * 24 * 60 * 60 * 1000,
};

/**
 * Feature Gate V2: VWAP stretch followed by normalized-range regime checks.
 *
 * Judges the signal point's distance from the monthly-anchored VWAP:
 * `|signal.p − vwap|` measured in σ must land inside the
 * `[minSigma, maxSigma]` zone, and the monthly envelope itself must be
 * at least `minStretchPct` wide. Returns the refusal reason, or
 * undefined when the candidate may pass.
 */
function rejectionReason(
    currentTime: number,
    features: RuntimeFeatures | undefined,
    signal: VolatilityPoint,
): string | undefined {
    // BOTH:FEATURE_GATE_INPUTS — shared pure inputs for runtime and inference.
    const symbol = signal.symbol ?? "";
    const currentLevel = Math.abs(signal?.lvl ?? 0);

    const vwapResult = vwapFilter(currentTime, features, signal);
    if (vwapResult) {
        return vwapResult;
    }


    // // Extreme condition
    // if (closeToExtreme(features, symbol, currentLevel, -5)) {
    //     return `Too close to extreme`
    // }


    if (isCurrentExtreme(features, symbol)) {
        return `Too much extreme`
    }


    // BOTH:FEATURE_GATE_REGIMES — shared by backtest, sandbox and live.
    return featureGateRegimes(currentTime, features, signal);
}


/** Returns the v2 decision with an explanation for either outcome. */
export default function featureGateV2(currentTime: number, features: RuntimeFeatures | undefined, signal: VolatilityPoint): FeatureGateResult {
    const reason = rejectionReason(currentTime, features, signal);
    const allowed = !Number.isFinite(signal.p) || signal.p <= 0
        ? "v2: VWAP presence and width checks passed; invalid signal price skips distance checks"
        : "v2: monthly VWAP stretch and normalized-range regime checks passed";
    return { allow: reason === undefined, message: reason ?? allowed };
}
