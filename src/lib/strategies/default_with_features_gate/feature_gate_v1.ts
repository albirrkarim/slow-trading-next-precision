import type { RuntimeContext } from "@/lib/precision/types";
import type { VolatilityPoint } from "@/lib/system/types/market";
import { FEATURE_GATE_BOUNDS, GATE_JUDGE_WINDOW_MS } from "./constants";
import {
    mapRange,
} from "./utils";


const recentValues = (cutoff: number, history: { p: number; t: number }[] | undefined) =>
    (history ?? [])
        .filter((point) => point.t >= cutoff)
        .map((point) => point.p);


/**
 * Feature Gate V1: 5 Oktober 2026
 * 
 * Train / tuning using the 5 year of other coin that not use for trade (unseen):
 * ADA, ETH, HBAR, SOL, XLM
 * 
 * It work 100% correct for the test dataset:
 * 
 * AAVE, LINK, SUI, XRP
 * 
 * Returns the feature-gate refusal for one symbol at the current tick, or
 * undefined when the candidate may pass.
 */
export function gateReason(
    context: RuntimeContext,
    symbol: string,
    signal?: VolatilityPoint,
): string | undefined {
    const bounds = FEATURE_GATE_BOUNDS;

    const currentLevel = Math.abs(signal?.lvl ?? 0);

    // Extremes judge only the freshest days of the trail — the record
    // itself keeps the full ~20-day window for display.
    const cutoff = context.state.currentTime - GATE_JUDGE_WINDOW_MS;


    const historiesBTCRaw = context.state.features?.coins["BTC"]?.priceNormalizedHistory ?? []
    const historiesSymbolRaw = context.state.features?.coins[symbol.toUpperCase()]?.priceNormalizedHistory ?? [];

    if ((historiesBTCRaw.length < 3 || historiesSymbolRaw.length < 2) && currentLevel < 3) {
        return "reject entry - no price normalized history";
    }

    const historiesBTC = recentValues(cutoff,
        historiesBTCRaw,
    );

    const historiesSymbol = recentValues(cutoff,
        historiesSymbolRaw,
    );

    const minBTC = Math.min(...historiesBTC);
    const maxBTC = Math.max(...historiesBTC);

    const minSymbol = Math.min(...historiesSymbol);
    const maxSymbol = Math.max(...historiesSymbol);

    const min = Math.min(minBTC, minSymbol);
    const max = Math.max(maxBTC, maxSymbol);

    const minLevelTop = Math.abs(mapRange(max, bounds.maxPriceNormalized, 2, 3, 5))
    const minLevelBottom = Math.abs(mapRange(min, bounds.minPriceNormalized, -2, 3, 5))

    if (max > bounds.maxPriceNormalized && currentLevel < minLevelTop) {
        return `PriceNormalized ${max.toFixed(3)} is above the max gate zone ${bounds.maxPriceNormalized.toFixed(3)} with level ${currentLevel}`;
    }

    if (min < bounds.minPriceNormalized && currentLevel < minLevelBottom) {
        return `PriceNormalized ${min.toFixed(3)} is below the min gate zone ${bounds.minPriceNormalized.toFixed(3)} with level ${currentLevel}`;
    }

    const arrBTC = historiesBTCRaw.map(p => p.p);
    // const arrSymbol = historiesSymbolRaw.map(p => p.p);

    const minBTCRaw = Math.min(...arrBTC);
    const maxBTCRaw = Math.max(...arrBTC);

    // const minSymbolRaw = Math.min(...arrSymbol);
    // const maxSymbolRaw = Math.max(...arrSymbol);

    // if (maxBTCRaw > 0.95 || minBTCRaw < 0) {
    //     return `BTC PriceNormalized ${maxBTCRaw.toFixed(3)} is above 1.0 or below 0.0`;
    // }


    // BTC recovery veto: BTC dipped below the normal-zone floor within the
    // trail and has since climbed back above it — the market is already on
    // an up-leg and the coin is likely to follow, so a TOP (short) signal
    // on the coin fights the move BTC has already made.
    const btcNow =
        context.state.features?.coins["BTC"]?.priceNormalized ?? arrBTC.at(-1);
    const btcRecovering =
        minBTCRaw < bounds.minPriceNormalized &&
        btcNow !== undefined &&
        btcNow > bounds.minPriceNormalized;

    if (btcRecovering && signal?.id.startsWith("T") && currentLevel < 3) {
        return (
            `BTC priceNormalized recovered from ${minBTCRaw.toFixed(3)} ` +
            `to ${btcNow.toFixed(3)} (above the min gate zone ` +
            `${bounds.minPriceNormalized}) — the coin is likely to follow up`
        );
    }

    if (maxBTCRaw > 0.95 && currentLevel < 3) {
        return `BTC PriceNormalized ${maxBTCRaw.toFixed(3)} is above 1.0 with level ${currentLevel}`;
    }


    if (btcNow && btcNow > 1 && currentLevel < 6) {
        return `BTC PriceNormalized ${btcNow.toFixed(3)} is above 1.0`;
    }

    if ((minBTCRaw < 0) && currentLevel < 5) {
        return `BTC PriceNormalized ${minBTCRaw.toFixed(3)} is below 0.0 with level ${currentLevel}`;
    }

    const symbolPriceNormalized = context.state.features?.coins[symbol.toUpperCase()]?.priceNormalized;

    if (symbolPriceNormalized !== undefined && symbolPriceNormalized < 0) {
        return `Symbol PriceNormalized ${symbolPriceNormalized.toFixed(3)} is below 0.0`;
    }

    return undefined;
}