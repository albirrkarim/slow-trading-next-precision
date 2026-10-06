import type { RuntimeContext } from "@/lib/precision/types";
import type { VolatilityPoint } from "@/lib/system/types/market";



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
 * - `maxSignalAgeMs`: reject signals older than 1 day — stretched points
 *   must be fresh; an aging vPoint can slide into the σ zone without
 *   representing a new stretched entry.
 */
export const FEATURE_GATE_VWAP_BOUNDS = {
    minStretchPct: 6,
    minSigma: 1.2,
    maxSigma: 1.7,
    maxSignalAgeMs: 24 * 60 * 60 * 1000,
};

/**
 * Feature Gate V2: VWAP-only.
 *
 * Judges the signal point's distance from the monthly-anchored VWAP:
 * `|signal.p − vwap|` measured in σ must land inside the
 * `[minSigma, maxSigma]` zone, and the monthly envelope itself must be
 * at least `minStretchPct` wide. Returns the refusal reason, or
 * undefined when the candidate may pass.
 */
export default function featureGateV2(
    context: RuntimeContext,
    symbol: string,
    signal?: VolatilityPoint,
): string | undefined {
    const bounds = FEATURE_GATE_VWAP_BOUNDS;
    const coin = context.state.features?.coins[symbol.toUpperCase()];
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
    // confirmation time, so an aging vPoint can drift into the σ zone as the
    // envelope stretches without representing a new stretched entry. A
    // missing/invalid `t` falls through (veto only on evidence).
    if (Number.isFinite(signal.t)) {
        const signalAgeMs = context.state.currentTime - signal.t;
        if (signalAgeMs > bounds.maxSignalAgeMs) {
            return (
                `signal vPoint is ${(signalAgeMs / 3_600_000).toFixed(1)}h ` +
                `old (> 24h) — stale stretch, not a fresh entry`
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



    // Extreme condition
    const historiesBTC = (context.state.features?.coins["BTC"]?.priceNormalized?.history ?? []).map(e => e.p).slice(-3)
    const historiesSymbol = (context.state.features?.coins[symbol.toUpperCase()]?.priceNormalized?.history ?? []).map(e => e.p).slice(-3)

    const currentLevel = Math.abs(signal?.lvl ?? 0);

    const minBTC = Math.min(...historiesBTC);
    const maxBTC = Math.max(...historiesBTC);

    const minSymbol = Math.min(...historiesSymbol);
    const maxSymbol = Math.max(...historiesSymbol);

    const min = Math.min(minBTC, minSymbol);
    const max = Math.max(maxBTC, maxSymbol);

    if ((max > 0.9 || min < 0.1)) {

        const coinBtc = context.state.features?.coins["BTC"].priceNormalized.current ?? 0
        const coinSymbol = context.state.features?.coins[symbol.toUpperCase()].priceNormalized.current ?? 0

        const minCurrent = Math.min(coinBtc, coinSymbol);
        const maxCurrent = Math.max(coinBtc, coinSymbol);

        if ((maxCurrent > 1 || minCurrent < 0)) {
            return `Too much extreme`
        }

        // if (currentLevel < 2) {
        //     if (dSigma > 1.5) {
        //         return `Extreme condition, low level, almost outside area`
        //     }
        //     // return `Extreme condition detected`
        // }
    }

    return undefined;
}
