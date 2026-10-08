import { RuntimeFeatures } from "@/lib/features";
import { FEATURE_GATE_VWAP_BOUNDS } from "./feature_gate_v2";
import { VolatilityPoint } from "@/lib/system";

interface MinimalBound {
    minStretchPct: number,
    minSigma: number,
    maxSigma: number,
    maxSignalAgeMs: number
}

export function vwapBounds(currentTime: number,
    features: RuntimeFeatures | undefined,
    signal: VolatilityPoint, bounds: MinimalBound = FEATURE_GATE_VWAP_BOUNDS) {
    const symbol = signal.symbol ?? "";

    const coin = features?.coins[symbol.toUpperCase()];
    const vwap = coin?.vwap?.price;
    const stdev = coin?.vwap?.stdev;
    const stretchPct = coin?.vwap?.stretchPct;

    if (typeof vwap !== "number" || !Number.isFinite(vwap) || vwap <= 0) {
        return "reject entry - no monthly VWAP feature";
    }

    if (
        typeof stretchPct !== "number" ||
        !Number.isFinite(stretchPct) ||
        stretchPct < bounds.minStretchPct
    ) {
        return (
            `monthly VWAP envelope is only ${(stretchPct ?? 0).toFixed(1)}% ` +
            `wide (< ${bounds.minStretchPct}%) — the wave is too narrow ` +
            `to mean-revert`
        );
    }

    // Without a signal the zone cannot be judged — pass (same contract as
    // v1: the gate only vetoes on evidence, never on absence).
    if (!signal || !Number.isFinite(signal.p) || signal.p <= 0) {
        return undefined;
    }

    // A stretched point is only admissible while fresh — `t` is the pivot's
    // timestamp (it becomes visible after confirmation), so an aging vPoint can drift into the σ zone as the
    // envelope stretches without representing a new stretched entry. A
    // missing/invalid `t` falls through (veto only on evidence).
    if (Number.isFinite(signal.t)) {
        const signalAgeMs = currentTime - signal.t;
        if (signalAgeMs > bounds.maxSignalAgeMs) {
            return (
                `signal vPoint is ${(signalAgeMs / 3_600_000).toFixed(1)}h ` +
                `old (> ${bounds.maxSignalAgeMs / 3_600_000}h) — stale ` +
                `stretch, not a fresh entry`
            );
        }
    }

    if (typeof stdev !== "number" || !Number.isFinite(stdev) || stdev <= 0) {
        return "reject entry - no VWAP σ data";
    }

    const dSigma = Math.abs(signal.p - vwap) / stdev;

    if (dSigma < bounds.minSigma) {
        return (
            `signal ${signal.p} is ${dSigma.toFixed(2)}σ from monthly VWAP ` +
            `${vwap} — inside the 1σ zone (not stretched enough)`
        );
    }

    if (dSigma > bounds.maxSigma) {
        return (
            `signal ${signal.p} is ${dSigma.toFixed(2)}σ from monthly VWAP ` +
            `${vwap} — beyond the 2σ extreme (overstretched)`
        );
    }

    return undefined
}

export function vwapFilter(
    currentTime: number,
    features: RuntimeFeatures | undefined,
    signal: VolatilityPoint,
): string | undefined {

    const bounds = FEATURE_GATE_VWAP_BOUNDS;
    const currentLevel = Math.abs(signal.lvl ?? 0);

    // Calendar rule, signal-independent: the VWAP anchor is monthly (UTC),
    // so a position opened inside the last 2 days of the month straddles a
    // band reset — entry context expires almost immediately.
    const now = currentTime;
    if (Number.isFinite(now)) {
        const d = new Date(now);
        const anchorMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
        const sinceAnchorMs = now - anchorMs;
        if (sinceAnchorMs < bounds.blockAfterMonthStartMs && currentLevel < 3) {
            return (
                `month started ${(sinceAnchorMs / 3_600_000).toFixed(1)}h ago ` +
                `(< ${bounds.blockAfterMonthStartMs / 3_600_000}h) — monthly ` +
                `VWAP envelope is too thin to judge σ`
            );
        }
        const nextAnchorMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
        const untilAnchorResetMs = nextAnchorMs - now;
        if (untilAnchorResetMs < bounds.blockBeforeMonthEndMs && currentLevel < 3) {
            return (
                `month ends in ${(untilAnchorResetMs / 3_600_000).toFixed(1)}h ` +
                `(< ${bounds.blockBeforeMonthEndMs / 3_600_000}h) — monthly ` +
                `VWAP anchor resets and the entry loses its context`
            );
        }
    }


    const vwapResult = vwapBounds(currentTime, features, signal);
    if (vwapResult) {
        return vwapResult;
    }

    return undefined
}