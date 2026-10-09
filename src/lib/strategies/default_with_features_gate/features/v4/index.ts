import type { RuntimeFeatures } from "@/lib/features/types";
import type { FeatureGateResult } from "@/lib/strategies/feature-gates";
import type { VolatilityPoint } from "@/lib/system/types/market";
import { vwapFilter } from "../v2/vwap";
import { isCurrentExtreme, isSuddenChange } from "../v2/price_norm";
import featureGateRegimes from "../v2/regimes";
import priceNormExhaustion from "@/lib/features/price-norm-exhaustion";

/** Ordered v4 check ids and their UI names. */
export const subGates = {
    vwap: "Monthly VWAP",
    exhaustion: "PriceNorm exhaustion",
    trend: "Sideways trend",
    suddenChange: "Sudden change",
    currentExtreme: "Current extreme",
    regimes: "Normalized-range regimes",
} as const;

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
 * Feature Gate V4: selected VWAP and normalized-range regime checks.
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
    enabledSubGates: string[],
): string | undefined {
    // BOTH:FEATURE_GATE_INPUTS — shared pure inputs for runtime and inference.
    const symbol = signal.symbol ?? "";
    const enabled = new Set(enabledSubGates);
    const currentLevel = signal.lvl ?? 0

    if (enabled.has("vwap")) {
        const vwapResult = vwapFilter(currentTime, features, signal);
        if (vwapResult && currentLevel < 3) return vwapResult;
    }


    // Extreme condition
    // if (closeToExtreme(features, symbol, currentLevel, -5)) {
    //     return `Too close to extreme`
    // }

    if (enabled.has("trend")) {
        const btcTrend = features?.coins["BTC"]?.priceNormalized?.trend ?? 0;
        const symbolTrend = features?.coins[symbol]?.priceNormalized?.trend ?? 0;

        if (Math.abs(btcTrend) > 0.5 || Math.abs(symbolTrend) > 0.5) {
            return "Too clear trend, our strategy prefer sideway";
        }
    }

    if (enabled.has("suddenChange") && isSuddenChange(features, symbol)) {
        return "Sudden change";
    }


    if (enabled.has("currentExtreme") && isCurrentExtreme(features, symbol)) {
        return "Too much extreme";
    }

    // BOTH:FEATURE_GATE_REGIMES — shared by backtest, sandbox and live.
    if (enabled.has("regimes")) {
        const res = featureGateRegimes(currentTime, features, signal)
        if (res) {
            return res
        }
    }

    if (enabled.has("exhaustion")) {
        const history = features?.coins[symbol]?.priceNormalized?.history ?? [];

        const ex = priceNormExhaustion.score(history)

        if (ex && ex > 0.7) {
            return "Exhausted"
        }
    }

    return undefined
}


/** Applies the selected v4 checks; live and backtest callers default to all checks. */
export default function featureGateV4(currentTime: number, features: RuntimeFeatures | undefined, signal: VolatilityPoint, enabledSubGates: string[] = Object.keys(subGates)): FeatureGateResult {
    const reason = rejectionReason(currentTime, features, signal, enabledSubGates);
    const allEnabled = Object.keys(subGates).every((gate) => enabledSubGates.includes(gate));
    const allowed = allEnabled
        ? (!Number.isFinite(signal.p) || signal.p <= 0
            ? "v4: VWAP presence and width checks passed; invalid signal price skips distance checks"
            : "v4: monthly VWAP stretch and normalized-range regime checks passed")
        : `v4: selected checks passed (${Object.keys(subGates).filter((gate) => enabledSubGates.includes(gate)).join(", ") || "none enabled"})`;
    return { allow: reason === undefined, message: reason ?? allowed };
}
