import type { RuntimeContext } from "@/lib/precision/types";
import type { VolatilityPoint } from "@/lib/system/types/market";
import featureGateRegimes from "./feature_gate_regimes";



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
    // timestamp (it becomes visible after confirmation), so an aging vPoint can drift into the σ zone as the
    // envelope stretches without representing a new stretched entry. A
    // missing/invalid `t` falls through (veto only on evidence).
    if (Number.isFinite(signal.t)) {
        const signalAgeMs = context.state.currentTime - signal.t;
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



    // Extreme condition
    const historiesBTC = (context.state.features?.coins["BTC"]?.priceNormalized?.history ?? []).slice(-3).map(e => e.p)
    const historiesSymbol = (context.state.features?.coins[symbol.toUpperCase()]?.priceNormalized?.history ?? []).slice(-3).map(e => e.p)

    const minBTC = Math.min(...historiesBTC);
    const maxBTC = Math.max(...historiesBTC);

    const minSymbol = Math.min(...historiesSymbol);
    const maxSymbol = Math.max(...historiesSymbol);

    const min = Math.min(minBTC, minSymbol);
    const max = Math.max(maxBTC, maxSymbol);

    if ((max > 0.95 || min < 0.1)) {
        return `extreme`
    }

    const coinBtc = context.state.features?.coins["BTC"]?.priceNormalized?.current
    const coinSymbol = context.state.features?.coins[symbol.toUpperCase()]?.priceNormalized?.current

    const currentValues = [coinBtc, coinSymbol].filter(
        (value): value is number => typeof value === "number" && Number.isFinite(value),
    );
    const minCurrent = Math.min(...currentValues);
    const maxCurrent = Math.max(...currentValues);

    if ((maxCurrent > 1 || minCurrent < 0)) {
        return `Too much extreme`
    }
    // return undefined

    // BOTH:FEATURE_GATE_REGIMES — shared by backtest, sandbox and live.
    return featureGateRegimes(context, symbol, signal);
}
