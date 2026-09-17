import { deepCopy } from "@/components/client/utils";
import { getRecommendationsProduction } from "@/lib/brain/algorithms";
import type { EntryRecommendation } from "@/lib/brain/algorithms/type-execute";
import type { ExchangeType } from "@/lib/exchange";
import { DEFAULT_EXCHANGE } from "@/lib/exchange/constants";
import { tradeLog } from "@/lib/trading";
import type { TradingModelMemory } from "@/lib/trading/models";
import moment from "moment-timezone";
import { cropVolatility } from "./priceNorm";
import type { VolatilityPoint } from "./volatility";

interface GetHistoricalEntrySignalProps {
  volatilityMap: Record<string, VolatilityPoint[]>;
  getRecommendations?: typeof getRecommendationsProduction;
  exchangeType?: ExchangeType;
  minActionableAbsoluteLevel?: number;
}

export async function getHistoricalEntrySignal({
  volatilityMap,
  getRecommendations = getRecommendationsProduction,
  exchangeType = DEFAULT_EXCHANGE as ExchangeType,
  minActionableAbsoluteLevel,
}: GetHistoricalEntrySignalProps): Promise<EntryRecommendation[]> {
  const volatilityMapForHistory = deepCopy(volatilityMap);
  const symbols = Object.keys(volatilityMapForHistory);

  for (const symbol of symbols) {
    for (const point of volatilityMapForHistory[symbol] ?? []) {
      delete point.used;
    }
  }

  const entryRecommendations: EntryRecommendation[] = [];

  const modelMemoryMap: Record<string, TradingModelMemory> = {};

  for (const symbol of symbols) {
    modelMemoryMap[symbol] = {
      positions: [],
      volatility: {
        symbol,
        lastVolatility: [],
      },
    };
  }

  tradeLog.debug("RUN INITIAL PRICE");

  // flattened time
  const times = [
    ...new Set(
      Object.values(volatilityMapForHistory) // get arrays for each key
        .flat() // flatten them
        .map((item) => item.t), // extract `time`
    ),
  ].sort((a, b) => a - b);

  tradeLog.debug("RUN BACKTEST");

  tradeLog.debug("start ", moment(times[0]).format("DD-MMM-YYYY HH:mm"));
  tradeLog.debug(
    "end ",
    moment(times[times.length - 1]).format("DD-MMM-YYYY HH:mm"),
  );

  for (const currentTimeMsLocal of times) {
    // B.2 Crop because we havent seen the next volatility points
    const cropedVMap = cropVolatility(
      currentTimeMsLocal,
      volatilityMapForHistory,
    );

    const entrySignals = await getRecommendations({
      volatilityPointsMap: cropedVMap,
      modelMemoryMap,
      minActionableAbsoluteLevel,
    });

    entryRecommendations.push(...entrySignals);
  }

  tradeLog.debug("RUN BACKTEST END");

  return entryRecommendations;
}
