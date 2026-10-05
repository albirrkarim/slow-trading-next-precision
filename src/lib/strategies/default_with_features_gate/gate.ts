import type { RuntimeContext } from "@/lib/precision/types";
import { windowsMs } from "@/lib/system/constants";
import type { VolatilityPoint } from "@/lib/system/types/market";
import { FEATURE_GATE_BOUNDS } from "./constants";
import {
    mapRange,
} from "./utils";


const recentValues = (cutoff: number, history: { p: number; t: number }[] | undefined) =>
    (history ?? [])
        .filter((point) => point.t >= cutoff)
        .map((point) => point.p);


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

    const currentLevel = Math.abs(signal?.lvl ?? 0);

    // Extremes judge only the freshest ~10 days of the trail — the record
    // itself keeps the full ~20-day window for display.
    const cutoff = context.state.currentTime - 10 * windowsMs["1d"];


    const historiesBTC = recentValues(cutoff,
        context.state.features?.coins["BTC"]?.priceNormalizedHistory,
    );
    
    const historiesSymbol = recentValues(cutoff,
        context.state.features?.coins[symbol.toUpperCase()]
            ?.priceNormalizedHistory,
    );

    if (historiesBTC.length < 2 || historiesSymbol.length < 2) {
        return "reject entry - no price normalized history";
    }

    const minBTC = Math.min(...historiesBTC);
    const maxBTC = Math.max(...historiesBTC);
    const minSymbol = Math.min(...historiesSymbol);
    const maxSymbol = Math.max(...historiesSymbol);

    const min = Math.min(minBTC, minSymbol);
    const max = Math.max(maxBTC, maxSymbol);

    const minLevelTop = Math.abs(mapRange(max, bounds.maxPriceNormalized, 2, 3, 6));
    const minLevelBottom = Math.abs(mapRange(min, bounds.minPriceNormalized, -2, 3, 6));

    if (max > bounds.maxPriceNormalized && currentLevel < minLevelTop) {
        return `PriceNormalized ${max.toFixed(3)} is above the max gate zone ${bounds.maxPriceNormalized.toFixed(3)} with level ${currentLevel}`;
    }

    if (min < bounds.minPriceNormalized && currentLevel < minLevelBottom) {
        return `PriceNormalized ${min.toFixed(3)} is below the min gate zone ${bounds.minPriceNormalized.toFixed(3)} with level ${currentLevel}`;
    }

    if (min < 0) {
        return `PriceNormalized ${min.toFixed(3)} is negative`;
    }

    return undefined;
}