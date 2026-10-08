import { RuntimeFeatures } from "@/lib/features";

export function closeToExtreme(features: RuntimeFeatures | undefined, symbol: string, currentLevel: number, threshold = -5) {
    const historiesBTC = (features?.coins["BTC"]?.priceNormalized?.history ?? []).slice(threshold).map(e => e.p)
    const historiesSymbol = (features?.coins[symbol.toUpperCase()]?.priceNormalized?.history ?? []).slice(threshold).map(e => e.p)

    const minBTC = Math.min(...historiesBTC);
    const maxBTC = Math.max(...historiesBTC);

    const minSymbol = Math.min(...historiesSymbol);
    const maxSymbol = Math.max(...historiesSymbol);

    const min = Math.min(minBTC, minSymbol);
    const max = Math.max(maxBTC, maxSymbol);

    if ((max > 0.96 || min < 0) && currentLevel < 4) {
        return true;
    }

    return false;
}

export function isCurrentExtreme(features: RuntimeFeatures | undefined, symbol: string) {

    const coinBtc = features?.coins["BTC"]?.priceNormalized?.current
    const coinSymbol = features?.coins[symbol.toUpperCase()]?.priceNormalized?.current

    const currentValues = [coinBtc, coinSymbol].filter(
        (value): value is number => typeof value === "number" && Number.isFinite(value),
    );
    const minCurrent = Math.min(...currentValues);
    const maxCurrent = Math.max(...currentValues);

    if ((maxCurrent > 1 || minCurrent < 0)) {
        return true;
    }

    return false;
}


export function isSuddenChange(features: RuntimeFeatures | undefined, symbol: string, threshold = 0.2) {

    const ofBtc = Math.abs((features?.coins["BTC"]?.priceNormalized.history.at(-1)?.p ?? 0) -
        (features?.coins["BTC"]?.priceNormalized.history.at(-2)?.p ?? 0))

    const theSymbol = Math.abs((features?.coins[symbol.toUpperCase()]?.priceNormalized.history.at(-1)?.p ?? 0) -
        (features?.coins[symbol.toUpperCase()]?.priceNormalized.history.at(-2)?.p ?? 0))

    return ofBtc > threshold || theSymbol > threshold
}
