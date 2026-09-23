import { TradingMode } from "@/lib/exchange/types";
import type { EntryRecommendation } from "./types";

function mapScaleValue(
  inputMin: number,
  inputMax: number,
  value: number,
  outputMin: number,
  outputMax: number,
): number {
  const clampedValue = Math.max(inputMin, Math.min(inputMax, value));
  const inputRange = inputMax - inputMin;
  const proportion = (clampedValue - inputMin) / inputRange;

  return outputMin + proportion * (outputMax - outputMin);
}

/**
 * Resolves the leverage shared by backtest and production futures entries.
 *
 * BOTH:LEVERAGE_CALCULATION
 */
function resolveEntryLeverage(params: {
  entrySignal: EntryRecommendation;
  tradingMode: TradingMode;
  config?: {
    exactLeverage?: number;
    maxLeverage?: number;
  };
}) {
  if (params.tradingMode !== TradingMode.FUTURES) {
    return 1;
  }

  const exactLeverage = params.config?.exactLeverage;

  if (
    typeof exactLeverage === "number" &&
    Number.isFinite(exactLeverage) &&
    exactLeverage > 0
  ) {
    return Math.max(1, Math.floor(exactLeverage));
  }

  const leverageFromProbability = Math.floor(
    mapScaleValue(0.3, 1, params.entrySignal.amountProbab, 3, 4),
  );

  let leverage = leverageFromProbability;
  const engineMaxLeverage = params.entrySignal.maxLeverage;
  const configMaxLeverage = params.config?.maxLeverage;

  // Cap by engine
  if (
    Number.isFinite(engineMaxLeverage) &&
    engineMaxLeverage > 0 &&
    engineMaxLeverage < leverage
  ) {
    leverage = engineMaxLeverage;
  }

  // Cap by human
  if (
    typeof configMaxLeverage === "number" &&
    Number.isFinite(configMaxLeverage) &&
    configMaxLeverage > 0 &&
    configMaxLeverage < leverage
  ) {
    leverage = configMaxLeverage;
  }

  return Math.max(1, Math.floor(leverage));
}

const runtimeEntryLeverage = {
  resolve: resolveEntryLeverage,
} as const;

export default runtimeEntryLeverage;
export { runtimeEntryLeverage };
