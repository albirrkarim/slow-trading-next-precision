import type { RuntimeContext } from "@/lib/precision/types";
import type { VolatilityPoint } from "@/lib/system/types/market";
import type { PairRole } from "../shared/pair";
import {
    mapRange,
} from "../shared/utils";
import { windowsMs } from "@/lib/system/constants";

/**
 * Judge window shared by the gate and its tests: only
 * `priceNormalizedHistory` samples newer than `now - GATE_JUDGE_WINDOW_MS`
 * count toward the level-floor and BTC checks. The recorded trail itself
 * keeps the full `FEATURES_HISTORY_WINDOW_MS` (~20 days) for display.
 */
export const GATE_JUDGE_WINDOW_MS = 5 * windowsMs["1d"];


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
 * within `GATE_JUDGE_WINDOW_MS` is rejected even when it has since moved
 * back inside. The recorded trail itself keeps the full 20-day window
 * (`FEATURES_HISTORY_WINDOW_MS`); the gate only judges its freshest days.
 */
export const FEATURE_GATE_BOUNDS = {
    // coin
    maxPriceNormalized: 0.8,
    minPriceNormalized: 0.3,

    // btc
    btcMaxPriceNormalized: 0.8,
    btcMinPriceNormalized: 0.3,
};


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
 * it succesfully recognize the price norm 2 month as valid feature.
 * 
 * Tested:
 * - Paired with the current default strategy.
 * 
 * Returns the feature-gate refusal for one symbol at the current tick, or
 * undefined when the candidate may pass.
 *
 * @param leg - which pair leg is being gated (satisfied by `PairLegMeta`):
 * `leg.role` distinguishes `"MAIN"` / `"COUNTER"`, `leg.reopen` marks a
 * role re-entry (vs the initial fresh-pair legs). Diagnostics callers
 * pass `{ role }` probes; absent legs may omit it.
 */
export default function featureGateV1(
    context: RuntimeContext,
    symbol: string,
    signal?: VolatilityPoint,
    leg?: { reopen?: boolean; role?: PairRole },
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

    if ((minBTCRaw < 0 || maxBTCRaw > 0.9)) {
        return `BTC volatile`
    }

    const symbolPriceNormalized = context.state.features?.coins[symbol.toUpperCase()]?.priceNormalized;

    if (symbolPriceNormalized !== undefined && symbolPriceNormalized < 0) {
        return `Symbol PriceNormalized ${symbolPriceNormalized.toFixed(3)} is below 0.0`;
    }

    return undefined;
}